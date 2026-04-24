import { useState, useCallback, useEffect } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import rawIdl from "../../target/idl/corenet.json";

const IDL = rawIdl as unknown as Idl;
const PROGRAM_ID = new PublicKey("FM7AiquU7fx1Ng9W5QGwQLhsjwZfAa7LE7K3Tr4baskQ");
const RPC = "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");

// ── PDA helpers ──────────────────────────────────────────────────────────────
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

const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
const lamports = (s: string) => Math.round(parseFloat(s) * LAMPORTS_PER_SOL);

type Role = "provider" | "client";
type LogEntry = { kind: "ok" | "err" | "inf"; text: string; ts: string };
type WalletWindow = Window & {
  solana?: { connect(): Promise<{ publicKey: PublicKey }>; publicKey: PublicKey };
};

interface NetworkInfo { admin: string; totalNodes: number; totalJobs: number }
interface NodeInfo { cpu: number; ram: number; storage: number; price: string; reputation: number; jobs: number; active: number; isActive: boolean }
interface JobInfo { status: string; client: string; provider: string; payment: string; cpu: number; ram: number; spec: string; result: string }

export default function App() {
  const [wallet, setWallet]     = useState<PublicKey | null>(null);
  const [balance, setBalance]   = useState<number>(0);
  const [role, setRole]         = useState<Role>("provider");
  const [logs, setLogs]         = useState<LogEntry[]>([]);
  const [network, setNetwork]   = useState<NetworkInfo | null>(null);
  const [myNode, setMyNode]     = useState<NodeInfo | null>(null);
  const [jobInfo, setJobInfo]   = useState<JobInfo | null>(null);

  // Provider fields
  const [cpu, setCpu]       = useState("4");
  const [ram, setRam]       = useState("8");
  const [storage, setStorage] = useState("500");
  const [priceSol, setPriceSol] = useState("0.001");

  // Client fields
  const [provKey, setProvKey]   = useState("");
  const [jobId, setJobId]       = useState("1");
  const [reqCpu, setReqCpu]     = useState("2");
  const [reqRam, setReqRam]     = useState("4");
  const [paySol, setPaySol]     = useState("0.001");
  const [spec, setSpec]         = useState(`{"image":"python:3.11-slim","cmd":"python -c 'print(2+2)'"}`);
  const [uploading, setUploading] = useState(false);

  // Manage fields
  const [mJobId, setMJobId]     = useState("1");
  const [mClient, setMClient]   = useState("");

  const log = useCallback((kind: LogEntry["kind"], text: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs(p => [{ kind, text, ts }, ...p].slice(0, 40));
  }, []);

  function getProgram() {
    const phantom = (window as WalletWindow).solana;
    if (!phantom?.publicKey) throw new Error("Wallet no conectada");
    const provider = new AnchorProvider(conn, phantom as never, { commitment: "confirmed" });
    return new Program(IDL, provider);
  }

  async function refreshBalance(pk: PublicKey) {
    const b = await conn.getBalance(pk);
    setBalance(b);
  }

  async function refreshNetwork() {
    try {
      const p = getProgram();
      const net = await (p.account as never as {
        networkState: { fetch(k: PublicKey): Promise<{ admin: PublicKey; totalNodes: number; totalJobs: BN }> }
      }).networkState.fetch(networkPDA());
      setNetwork({ admin: net.admin.toBase58(), totalNodes: net.totalNodes, totalJobs: net.totalJobs.toNumber() });
    } catch { /* not initialized */ }
  }

  async function refreshNode(pk: PublicKey) {
    try {
      const p = getProgram();
      const n = await (p.account as never as {
        nodeAccount: { fetch(k: PublicKey): Promise<{
          cpuCores: number; ramGb: number; storageGb: number;
          pricePerJob: BN; jobsCompleted: BN; activeJobs: number;
          reputation: number; isActive: boolean;
        }> }
      }).nodeAccount.fetch(nodePDA(pk));
      setMyNode({
        cpu: n.cpuCores, ram: n.ramGb, storage: n.storageGb,
        price: sol(n.pricePerJob.toNumber()),
        reputation: n.reputation,
        jobs: n.jobsCompleted.toNumber(),
        active: n.activeJobs,
        isActive: n.isActive,
      });
    } catch { setMyNode(null); }
  }

  async function refreshJob(clientPk: PublicKey, jid: number) {
    try {
      const p = getProgram();
      const j = await (p.account as never as {
        jobAccount: { fetch(k: PublicKey): Promise<{
          client: PublicKey; provider: PublicKey; payment: BN;
          requiredCpu: number; requiredRam: number; status: Record<string, unknown>;
          spec: string; result: string;
        }> }
      }).jobAccount.fetch(jobPDA(clientPk, jid));
      const statusKey = Object.keys(j.status)[0];
      setJobInfo({
        status: statusKey,
        client: j.client.toBase58(),
        provider: j.provider.toBase58(),
        payment: sol(j.payment.toNumber()),
        cpu: j.requiredCpu,
        ram: j.requiredRam,
        spec: j.spec,
        result: j.result,
      });
    } catch { setJobInfo(null); }
  }

  useEffect(() => {
    if (wallet) { refreshBalance(wallet); refreshNetwork(); refreshNode(wallet); }
  }, [wallet]); // eslint-disable-line

  async function connect() {
    try {
      const phantom = (window as WalletWindow).solana;
      if (!phantom) throw new Error("Instala Backpack o Phantom");
      const res = await phantom.connect();
      setWallet(res.publicKey);
      log("ok", `Conectado: ${res.publicKey.toBase58()}`);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function airdrop() {
    if (!wallet) return;
    try {
      const sig = await conn.requestAirdrop(wallet, 2 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig);
      await refreshBalance(wallet);
      log("ok", `Airdrop 2 SOL recibido`);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function initialize() {
    try {
      const p = getProgram();
      await (p.methods as never as { initialize(): { accounts(a: object): { rpc(): Promise<string> } } })
        .initialize().accounts({ admin: wallet!, networkState: networkPDA() }).rpc();
      log("ok", "Red inicializada ✓");
      await refreshNetwork();
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function registerNode() {
    try {
      const p = getProgram();
      await (p.methods as never as { registerNode(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .registerNode(Number(cpu), Number(ram), Number(storage), new BN(lamports(priceSol)))
        .accounts({ provider: wallet!, nodeAccount: nodePDA(wallet!), networkState: networkPDA() }).rpc();
      log("ok", `Nodo registrado ✓  CPU:${cpu} RAM:${ram}GB  Precio:${priceSol} SOL/job`);
      await refreshNode(wallet!);
      await refreshNetwork();
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function submitJob() {
    try {
      const prov = new PublicKey(provKey.trim());
      const jid = Number(jobId);
      const p = getProgram();
      const pda = jobPDA(wallet!, jid);
      await (p.methods as never as { submitJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .submitJob(new BN(jid), Number(reqCpu), Number(reqRam), new BN(lamports(paySol)), spec)
        .accounts({ client: wallet!, providerNode: nodePDA(prov), jobAccount: pda }).rpc();
      log("ok", `Job #${jid} enviado ✓  Escrow: ${sol(lamports(paySol))} SOL bloqueados`);
      setMClient(wallet!.toBase58());
      setMJobId(String(jid));
      await refreshBalance(wallet!);
      await refreshJob(wallet!, jid);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function acceptJob() {
    try {
      const client = new PublicKey(mClient.trim());
      const jid = Number(mJobId);
      const p = getProgram();
      await (p.methods as never as { acceptJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .acceptJob(new BN(jid))
        .accounts({ provider: wallet!, nodeAccount: nodePDA(wallet!), jobAccount: jobPDA(client, jid) }).rpc();
      log("ok", `Job #${jid} aceptado ✓  Iniciando trabajo…`);
      await refreshNode(wallet!);
      await refreshJob(client, jid);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function completeJob() {
    try {
      const client = new PublicKey(mClient.trim());
      const jid = Number(mJobId);
      const p = getProgram();
      await (p.methods as never as { completeJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .completeJob(new BN(jid), "")
        .accounts({ provider: wallet!, client, nodeAccount: nodePDA(wallet!), jobAccount: jobPDA(client, jid), networkState: networkPDA() }).rpc();
      log("ok", `Job #${jid} completado ✓  Pago liberado al proveedor`);
      await refreshBalance(wallet!);
      await refreshNode(wallet!);
      await refreshNetwork();
      setJobInfo(null);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function cancelJob() {
    try {
      const jid = Number(mJobId);
      const p = getProgram();
      await (p.methods as never as { cancelJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .cancelJob(new BN(jid))
        .accounts({ client: wallet!, jobAccount: jobPDA(wallet!, jid) }).rpc();
      log("ok", `Job #${jid} cancelado ✓  Reembolso enviado`);
      await refreshBalance(wallet!);
      setJobInfo(null);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function deregisterNode() {
    try {
      const p = getProgram();
      await (p.methods as never as { deregisterNode(): { accounts(a: object): { rpc(): Promise<string> } } })
        .deregisterNode()
        .accounts({ provider: wallet!, nodeAccount: nodePDA(wallet!), networkState: networkPDA() }).rpc();
      log("ok", "Nodo eliminado ✓");
      setMyNode(null);
      await refreshNetwork();
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:5001/api/v0/add?pin=true", { method: "POST", body: form })
        .catch(() => { throw new Error("IPFS daemon no está corriendo. Ejecuta: ipfs daemon"); });
      if (!res.ok) throw new Error("IPFS upload fallido");
      const json = await res.json() as { Hash: string };
      const cid = json.Hash;
      log("ok", `Archivo subido a IPFS: ${cid}`);
      try {
        const current = JSON.parse(spec) as Record<string, unknown>;
        setSpec(JSON.stringify({ ...current, input_cid: cid, output_path: "/output" }));
      } catch { setSpec(JSON.stringify({ image: "alpine", cmd: "ls /input", input_cid: cid, output_path: "/output" })); }
    } catch (e: unknown) { log("err", String(e)); }
    finally { setUploading(false); }
  }

  const isIpfsCid = (s: string) => s.startsWith("ipfs://") || s.startsWith("Qm") || s.startsWith("bafy");
  const ipfsUrl   = (s: string) => `https://ipfs.io/ipfs/${s.replace("ipfs://", "")}`;

  const statusColor: Record<string, string> = {
    pending: "#f3c97d", accepted: "#7db8f3", completed: "#7df3a0", cancelled: "#f37d7d",
  };

  return (
    <div style={{ fontFamily: "monospace", background: "#0a0a0a", color: "#e0e0e0", minHeight: "100vh", padding: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ color: "#7df3a0", fontSize: 22, margin: 0 }}>CoreNet</h1>
          <div style={{ color: "#444", fontSize: 12 }}>Distributed Computing Network · Localnet</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {wallet && <span style={{ fontSize: 12, color: "#7df3a0" }}>{sol(balance)} SOL</span>}
          {wallet && (
            <span style={{ fontSize: 11, color: "#555", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {wallet.toBase58()}
            </span>
          )}
          <Btn onClick={airdrop} disabled={!wallet}>Airdrop 2 SOL</Btn>
          <Btn primary onClick={connect}>{wallet ? "✓ Conectado" : "Conectar Wallet"}</Btn>
        </div>
      </div>

      {/* ── Network Stats ── */}
      {network && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <Stat label="Nodos activos" value={String(network.totalNodes)} />
          <Stat label="Jobs completados" value={String(network.totalJobs)} />
          <Stat label="Admin" value={network.admin.slice(0, 8) + "…"} />
        </div>
      )}
      {!network && wallet && (
        <div style={{ marginBottom: 16 }}>
          <Btn onClick={initialize}>Inicializar red (solo admin)</Btn>
        </div>
      )}

      {/* ── Role tabs ── */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid #222" }}>
        {(["provider", "client"] as Role[]).map(r => (
          <button key={r} onClick={() => setRole(r)} style={{
            padding: "8px 24px", border: "none", background: "none", cursor: "pointer",
            color: role === r ? "#7df3a0" : "#555", fontFamily: "monospace", fontSize: 13,
            borderBottom: role === r ? "2px solid #7df3a0" : "2px solid transparent",
            textTransform: "capitalize",
          }}>
            {r === "provider" ? "⚙ Proveedor" : "💼 Cliente"}
          </button>
        ))}
      </div>

      {/* ══ PROVIDER VIEW ══ */}
      {role === "provider" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Node status */}
          <Card title="Mi Nodo">
            {myNode ? (
              <div style={{ fontSize: 13, lineHeight: 2 }}>
                <Row label="Estado" value={myNode.isActive ? "🟢 Activo" : "🔴 Inactivo"} />
                <Row label="CPU" value={`${myNode.cpu} cores`} />
                <Row label="RAM" value={`${myNode.ram} GB`} />
                <Row label="Storage" value={`${myNode.storage} GB`} />
                <Row label="Precio" value={`${myNode.price} SOL/job`} />
                <Row label="Reputación" value={`${myNode.reputation}/100 ${"★".repeat(Math.round(myNode.reputation / 20))}${"☆".repeat(5 - Math.round(myNode.reputation / 20))}`} />
                <Row label="Jobs completados" value={String(myNode.jobs)} />
                <Row label="Jobs activos" value={String(myNode.active)} />
                <div style={{ marginTop: 12 }}>
                  <Btn danger onClick={deregisterNode} disabled={myNode.active > 0}>
                    {myNode.active > 0 ? "No puedes deregistrar (jobs activos)" : "Eliminar nodo"}
                  </Btn>
                </div>
              </div>
            ) : (
              <div style={{ color: "#555", fontSize: 13 }}>No tienes un nodo registrado.</div>
            )}
          </Card>

          {/* Register node */}
          <Card title="Registrar Nodo">
            <Field label="CPU cores" value={cpu} onChange={setCpu} />
            <Field label="RAM (GB)" value={ram} onChange={setRam} />
            <Field label="Storage (GB)" value={storage} onChange={setStorage} />
            <Field label="Precio por job (SOL)" value={priceSol} onChange={setPriceSol} placeholder="0.001" />
            <div style={{ marginTop: 14 }}>
              <Btn primary onClick={registerNode} disabled={!wallet}>
                {myNode ? "Actualizar nodo" : "Registrar nodo"}
              </Btn>
            </div>
          </Card>

          {/* Manage jobs */}
          <Card title="Gestionar Jobs" style={{ gridColumn: "span 2" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <Field label="Job ID" value={mJobId} onChange={setMJobId} />
                <Field label="Pubkey del cliente" value={mClient} onChange={setMClient} placeholder="Base58…" />
                <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                  <Btn onClick={acceptJob} disabled={!wallet || !mClient}>Aceptar job</Btn>
                  <Btn primary onClick={completeJob} disabled={!wallet || !mClient}>Completar job</Btn>
                </div>
              </div>
              {jobInfo && (
                <div style={{ background: "#111", borderRadius: 6, padding: 12, fontSize: 13, lineHeight: 2 }}>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{
                      background: statusColor[jobInfo.status] + "22",
                      color: statusColor[jobInfo.status],
                      padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: "bold",
                      textTransform: "uppercase",
                    }}>{jobInfo.status}</span>
                  </div>
                  <Row label="Pago en escrow" value={`${jobInfo.payment} SOL`} />
                  <Row label="CPU requerida" value={`${jobInfo.cpu} cores`} />
                  <Row label="RAM requerida" value={`${jobInfo.ram} GB`} />
                  {jobInfo.spec && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: "#555", marginBottom: 2 }}>SPEC</div>
                      <code style={{ fontSize: 11, color: "#7db8f3", wordBreak: "break-all" }}>{jobInfo.spec}</code>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ══ CLIENT VIEW ══ */}
      {role === "client" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Submit job */}
          <Card title="Solicitar Cómputo">
            <Field label="Proveedor (pubkey)" value={provKey} onChange={setProvKey} placeholder="Base58…" />
            <Field label="Job ID" value={jobId} onChange={setJobId} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <div><Field label="CPU necesaria (cores)" value={reqCpu} onChange={setReqCpu} /></div>
              <div><Field label="RAM necesaria (GB)" value={reqRam} onChange={setReqRam} /></div>
            </div>
            <Field label="Pago (SOL)" value={paySol} onChange={setPaySol} placeholder="0.001" />
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#555" }}>Job spec (JSON)</div>
                <label style={{
                  fontSize: 11, color: uploading ? "#555" : "#7db8f3", cursor: uploading ? "wait" : "pointer",
                  border: "1px solid #222", padding: "3px 10px", borderRadius: 3,
                }}>
                  {uploading ? "Subiendo…" : "↑ Subir archivo a IPFS"}
                  <input type="file" style={{ display: "none" }} onChange={handleFileUpload} disabled={uploading} />
                </label>
              </div>
              <textarea
                value={spec}
                onChange={e => setSpec(e.target.value)}
                rows={4}
                style={{
                  width: "100%", padding: "6px 10px", background: "#0a0a0a",
                  border: "1px solid #222", color: "#7db8f3", fontFamily: "monospace",
                  fontSize: 12, borderRadius: 3, boxSizing: "border-box", resize: "vertical",
                }}
              />
              <div style={{ fontSize: 10, color: "#333", marginTop: 2 }}>
                Con archivo: <span style={{ color: "#2a4a3a" }}>{"{"}"image":"...","cmd":"...","input_cid":"Qm...","output_path":"/output"{"}"}</span>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn primary onClick={submitJob} disabled={!wallet || !provKey}>
                Enviar job → Bloquear {paySol} SOL en escrow
              </Btn>
            </div>
          </Card>

          {/* Job status */}
          <Card title="Estado del Job">
            <Field label="Job ID" value={mJobId} onChange={setMJobId} />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <Btn onClick={() => refreshJob(wallet!, Number(mJobId))} disabled={!wallet}>
                Consultar
              </Btn>
              <Btn danger onClick={cancelJob} disabled={!wallet}>
                Cancelar job
              </Btn>
            </div>
            {jobInfo && (
              <div style={{ marginTop: 16, background: "#111", borderRadius: 6, padding: 12, fontSize: 13, lineHeight: 2 }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{
                    background: statusColor[jobInfo.status] + "22",
                    color: statusColor[jobInfo.status],
                    padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: "bold",
                    textTransform: "uppercase",
                  }}>{jobInfo.status}</span>
                </div>
                <Row label="Pago bloqueado" value={`${jobInfo.payment} SOL`} />
                <Row label="CPU" value={`${jobInfo.cpu} cores`} />
                <Row label="RAM" value={`${jobInfo.ram} GB`} />
                <Row label="Proveedor" value={jobInfo.provider.slice(0, 16) + "…"} />
                {jobInfo.result && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Output</div>
                    {isIpfsCid(jobInfo.result) ? (
                      <div style={{ background: "#050505", border: "1px solid #1a1a1a", borderRadius: 4, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>Archivo disponible en IPFS</div>
                        <code style={{ fontSize: 11, color: "#7db8f3", wordBreak: "break-all" }}>{jobInfo.result}</code>
                        <div style={{ marginTop: 8 }}>
                          <a href={ipfsUrl(jobInfo.result)} target="_blank" rel="noreferrer" style={{
                            fontSize: 12, color: "#7df3a0", textDecoration: "none",
                            border: "1px solid #7df3a020", padding: "4px 10px", borderRadius: 3,
                          }}>
                            ↗ Ver en gateway IPFS
                          </a>
                        </div>
                      </div>
                    ) : (
                      <pre style={{
                        background: "#050505", border: "1px solid #1a1a1a", borderRadius: 4,
                        padding: "8px 10px", margin: 0, fontSize: 12, color: "#7df3a0",
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                      }}>{jobInfo.result}</pre>
                    )}
                  </div>
                )}
              </div>
            )}
            {!jobInfo && (
              <div style={{ marginTop: 16, color: "#444", fontSize: 13 }}>
                Consulta un job para ver su estado.
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Log ── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#444", textTransform: "uppercase", letterSpacing: 1 }}>Actividad</span>
          <button onClick={() => setLogs([])} style={{ fontSize: 11, color: "#444", background: "none", border: "none", cursor: "pointer" }}>
            Limpiar
          </button>
        </div>
        <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 4, padding: 12, maxHeight: 200, overflowY: "auto", fontSize: 12, lineHeight: 1.8 }}>
          {logs.length === 0 && <span style={{ color: "#333" }}>Sin actividad…</span>}
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.kind === "ok" ? "#7df3a0" : l.kind === "err" ? "#f37d7d" : "#7db8f3" }}>
              <span style={{ color: "#333", marginRight: 8 }}>{l.ts}</span>{l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, primary, danger }: {
  children: React.ReactNode; onClick(): void; disabled?: boolean; primary?: boolean; danger?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "7px 14px", border: `1px solid ${danger ? "#f37d7d" : primary ? "#7df3a0" : "#333"}`,
      background: danger ? "#2a0a0a" : primary ? "#0a2a1a" : "#111",
      color: danger ? "#f37d7d" : primary ? "#7df3a0" : "#aaa",
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
      fontFamily: "monospace", fontSize: 12, borderRadius: 4, whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

function Card({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: 20, ...style }}>
      <div style={{ fontSize: 11, color: "#7df3a0", letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange(v: string): void; placeholder?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "6px 10px", background: "#0a0a0a", border: "1px solid #222", color: "#e0e0e0", fontFamily: "monospace", fontSize: 13, borderRadius: 3, boxSizing: "border-box" }} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 6, padding: "10px 20px", minWidth: 120 }}>
      <div style={{ fontSize: 20, color: "#7df3a0", fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#555" }}>{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1a1a1a" }}>
      <span style={{ color: "#555" }}>{label}</span>
      <span style={{ color: "#e0e0e0" }}>{value}</span>
    </div>
  );
}
