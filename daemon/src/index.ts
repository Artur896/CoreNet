/**
 * CoreNet Provider Daemon
 *
 * Watches the Solana chain for compute jobs accepted by this provider,
 * downloads inputs from IPFS, executes in Docker (with optional GPU),
 * uploads outputs to IPFS, and submits the result on-chain.
 *
 * Env vars:
 *   KEYPAIR     Path to provider keypair JSON  (default: ~/.config/solana/id.json)
 *   RPC         Solana RPC URL                 (default: http://127.0.0.1:8899)
 *   IPFS_API    Kubo HTTP API URL              (default: http://localhost:5001)
 *   POLL_MS     Poll interval in ms            (default: 5000)
 *   TIMEOUT_S   Docker job timeout in seconds  (default: 120)
 *
 * Job spec format (stored on-chain when client submits):
 *   {
 *     "image":       "python:3.11-slim",
 *     "cmd":         "python /input/script.py",
 *     "input_cid":   "QmXxx...",    // optional — IPFS CID of input bundle
 *     "output_path": "/output",     // optional — dir to upload as IPFS result
 *     "gpu":         false          // optional — enables --gpus all
 *   }
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, BN, Wallet, Idl } from "@coral-xyz/anchor";

// ── Config ────────────────────────────────────────────────────────────────────
const RPC          = process.env.RPC       ?? "http://127.0.0.1:8899";
const KEYPAIR_PATH = process.env.KEYPAIR   ?? path.join(os.homedir(), ".config/solana/id.json");
const IPFS_API     = process.env.IPFS_API  ?? "http://localhost:5001";
const POLL_MS      = Number(process.env.POLL_MS    ?? 5_000);
const TIMEOUT_S    = Number(process.env.TIMEOUT_S  ?? 120);
const MAX_RESULT   = 200;

const PROGRAM_ID = new PublicKey("FM7AiquU7fx1Ng9W5QGwQLhsjwZfAa7LE7K3Tr4baskQ");

// ── Load IDL ──────────────────────────────────────────────────────────────────
const IDL = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../target/idl/corenet.json"), "utf8")
) as Idl;

// ── Keypair ───────────────────────────────────────────────────────────────────
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")) as number[])
);
console.log(`[daemon] provider : ${keypair.publicKey.toBase58()}`);
console.log(`[daemon] rpc      : ${RPC}`);
console.log(`[daemon] ipfs     : ${IPFS_API}`);

// ── PDA helpers ───────────────────────────────────────────────────────────────
const networkPDA = () =>
  PublicKey.findProgramAddressSync([Buffer.from("network")], PROGRAM_ID)[0];

const nodePDA = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("node"), owner.toBuffer()], PROGRAM_ID)[0];

const jobPDA = (client: PublicKey, jobId: number) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(jobId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), client.toBuffer(), buf],
    PROGRAM_ID
  )[0];
};

// ── IPFS helpers ──────────────────────────────────────────────────────────────

/** Download a CID from IPFS into destDir as "input" file/dir. */
async function ipfsGet(cid: string, destDir: string): Promise<void> {
  const res = await fetch(`${IPFS_API}/api/v0/get?arg=${cid}`, { method: "POST" });
  if (!res.ok) throw new Error(`IPFS get failed: ${res.statusText}`);
  // kubo returns a tar stream — pipe it out
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(destDir, "input.tar"), buf);
  execSync(`tar -xf input.tar`, { cwd: destDir, stdio: "pipe" });
  fs.unlinkSync(path.join(destDir, "input.tar"));
}

/** Upload a single file or directory to IPFS. Returns the root CID. */
async function ipfsAdd(filePath: string): Promise<string> {
  const stat = fs.statSync(filePath);
  let cid: string;

  if (stat.isDirectory()) {
    // Upload directory recursively via kubo CLI (simplest reliable method)
    const out = execSync(`ipfs add -r -Q "${filePath}"`, { encoding: "utf8" });
    cid = out.trim().split("\n").pop()!;
  } else {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(filePath)]));
    const res = await fetch(`${IPFS_API}/api/v0/add?pin=true`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`IPFS add failed: ${res.statusText}`);
    const json = await res.json() as { Hash: string };
    cid = json.Hash;
  }

  return cid;
}

// ── Job spec ──────────────────────────────────────────────────────────────────
interface JobSpec {
  image: string;
  cmd: string;
  input_cid?: string;   // IPFS CID — downloaded to /input inside container
  output_path?: string; // path inside container to capture and upload to IPFS
  gpu?: boolean;        // enable --gpus all (requires NVIDIA Container Toolkit)
}

// ── Docker execution ──────────────────────────────────────────────────────────
async function runJob(spec: JobSpec, cpuCores: number, ramGb: number): Promise<string> {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "corenet-"));

  try {
    const inputDir  = path.join(tmpDir, "input");
    const outputDir = path.join(tmpDir, "output");
    fs.mkdirSync(inputDir,  { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    // Download input bundle from IPFS if provided
    if (spec.input_cid) {
      console.log(`  ↓ IPFS get ${spec.input_cid}`);
      await ipfsGet(spec.input_cid, inputDir);
      console.log(`  ✓ input ready`);
    }

    // Build docker run command
    const flags: string[] = [
      "--rm",
      `--cpus="${cpuCores}"`,
      `--memory="${ramGb}g"`,
      "--network=none",
      `-v "${inputDir}:/input:ro"`,
      `-v "${outputDir}:/output"`,
    ];

    if (spec.gpu) {
      flags.push("--gpus all");
      console.log(`  GPU passthrough enabled`);
    }

    const cmd = [
      "docker run",
      ...flags,
      `"${spec.image}"`,
      `sh -c ${JSON.stringify(spec.cmd)}`,
    ].join(" ");

    console.log(`  $ ${cmd}`);

    let stdout = "";
    try {
      stdout = execSync(cmd, {
        timeout: TIMEOUT_S * 1_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR: ${msg}`.slice(0, MAX_RESULT);
    }

    // Upload output directory to IPFS if output_path was specified
    if (spec.output_path) {
      const outEntries = fs.readdirSync(outputDir);
      if (outEntries.length > 0) {
        console.log(`  ↑ Uploading output to IPFS…`);
        const cid = await ipfsAdd(outputDir);
        console.log(`  ✓ output CID: ${cid}`);
        return `ipfs://${cid}`;
      }
      return "WARN: output_path set but no files written to /output";
    }

    // Return stdout for simple jobs
    return stdout.trim().slice(0, MAX_RESULT) || "(no output)";

  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── On-chain types ────────────────────────────────────────────────────────────
interface JobAccount {
  client: PublicKey;
  provider: PublicKey;
  jobId: BN;
  requiredCpu: number;
  requiredRam: number;
  payment: BN;
  status: Record<string, unknown>;
  spec: string;
  result: string;
  bump: number;
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
const processing = new Set<string>(); // prevent double-processing

async function poll(program: Program): Promise<void> {
  const jobs = await (program.account as unknown as {
    jobAccount: { all(): Promise<{ publicKey: PublicKey; account: JobAccount }[]> }
  }).jobAccount.all();

  for (const { publicKey: jobPubkey, account: job } of jobs) {
    const isAccepted = "accepted" in job.status;
    const isOurs     = job.provider.equals(keypair.publicKey);
    const key        = jobPubkey.toBase58();

    if (!isAccepted || !isOurs || processing.has(key)) continue;

    const jobId  = job.jobId.toNumber();
    const client = job.client;

    console.log(`\n[job #${jobId}] from ${client.toBase58().slice(0, 8)}…`);
    console.log(`  spec: ${job.spec}`);

    let spec: JobSpec;
    try {
      spec = JSON.parse(job.spec) as JobSpec;
      if (!spec.image || !spec.cmd) throw new Error("missing image or cmd");
    } catch {
      console.error(`  ✗ invalid spec, skipping`);
      continue;
    }

    processing.add(key);

    // Run asynchronously so multiple jobs can execute in parallel
    (async () => {
      try {
        const result = await runJob(spec, job.requiredCpu, job.requiredRam);
        console.log(`  result: ${result}`);

        await (program.methods as unknown as {
          completeJob(jobId: BN, result: string): {
            accounts(a: object): { rpc(): Promise<string> }
          }
        })
          .completeJob(new BN(jobId), result)
          .accounts({
            provider:     keypair.publicKey,
            client,
            nodeAccount:  nodePDA(keypair.publicKey),
            jobAccount:   jobPDA(client, jobId),
            networkState: networkPDA(),
          })
          .rpc();

        console.log(`  ✓ complete_job submitted — payment received`);
      } catch (err) {
        console.error(`  ✗ failed:`, err);
      } finally {
        processing.delete(key);
      }
    })().catch(console.error);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function main() {
  const conn     = new Connection(RPC, "confirmed");
  const wallet   = new Wallet(keypair);
  const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
  const program  = new Program(IDL, provider);

  console.log(`[daemon] polling every ${POLL_MS / 1000}s\n`);

  await poll(program);
  setInterval(() => poll(program).catch(console.error), POLL_MS);
}

main().catch(err => { console.error("fatal:", err); process.exit(1); });
