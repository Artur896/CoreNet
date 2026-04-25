import { useState, useCallback, useEffect, useRef } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import rawIdl from "../../target/idl/corenet.json";

const IDL      = rawIdl as unknown as Idl;
const PROGRAM_ID = new PublicKey("FM7AiquU7fx1Ng9W5QGwQLhsjwZfAa7LE7K3Tr4baskQ");
const RPC      = "http://127.0.0.1:8899";
const conn     = new Connection(RPC, "confirmed");

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       "#0d1117",
  surface:  "#161b22",
  card:     "#1c2128",
  cardHov:  "#21273a",
  border:   "#30363d",
  borderSub:"#21262d",
  accent:   "#3fb950",
  accentDim:"#238636",
  blue:     "#79c0ff",
  purple:   "#bc8cff",
  yellow:   "#d29922",
  red:      "#f85149",
  text:     "#e6edf3",
  muted:    "#8b949e",
  dim:      "#484f58",
  mono:     `"JetBrains Mono", "Fira Code", "Consolas", monospace`,
  sans:     `"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif`,
} as const;

const STATUS: Record<string, { color: string; label: string; icon: string }> = {
  pending:   { color: C.yellow,  label: "Pendiente", icon: "⏳" },
  accepted:  { color: C.blue,    label: "En proceso", icon: "⚙️" },
  completed: { color: C.accent,  label: "Completado", icon: "✅" },
  cancelled: { color: C.red,     label: "Cancelado",  icon: "✕"  },
};

// ── PDA helpers ───────────────────────────────────────────────────────────────
const networkPDA = () =>
  PublicKey.findProgramAddressSync([Buffer.from("network")], PROGRAM_ID)[0];
const nodePDA = (o: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("node"), o.toBuffer()], PROGRAM_ID)[0];
const jobPDA = (c: PublicKey, id: number) => {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(id));
  return PublicKey.findProgramAddressSync([Buffer.from("job"), c.toBuffer(), b], PROGRAM_ID)[0];
};

const sol   = (n: number) => (n / LAMPORTS_PER_SOL).toFixed(4);
const lamps = (s: string) => Math.round(parseFloat(s) * LAMPORTS_PER_SOL);
const short = (s: string, n = 6) => `${s.slice(0, n)}…${s.slice(-4)}`;

type Role     = "provider" | "client";
type LogKind  = "ok" | "err" | "inf";
type WalletW  = Window & { solana?: { connect(): Promise<{ publicKey: PublicKey }>; publicKey: PublicKey } };

interface NetworkInfo { admin: string; totalNodes: number; totalJobs: number }
interface NodeInfo    { cpu: number; ram: number; storage: number; price: string; reputation: number; jobs: number; active: number; isActive: boolean }
interface NodeEntry   { owner: string; cpu: number; ram: number; storage: number; price: string; reputation: number; jobs: number; isActive: boolean }
interface JobEntry    { jobId: number; client: string; provider: string; payment: string; cpu: number; ram: number; status: string; spec: string; result: string }
interface Log         { kind: LogKind; text: string; ts: string }

// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [wallet, setWallet]   = useState<PublicKey | null>(null);
  const [balance, setBalance] = useState(0);
  const [role, setRole]       = useState<Role>(() => (localStorage.getItem("cn_role") as Role) ?? "client");
  const [logs, setLogs]       = useState<Log[]>([]);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [myNode, setMyNode]   = useState<NodeInfo | null>(null);
  const [mounted, setMounted] = useState(false);

  const [allNodes, setAllNodes]         = useState<NodeEntry[]>([]);
  const [myJobs, setMyJobs]             = useState<JobEntry[]>([]);
  const [providerJobs, setProviderJobs] = useState<JobEntry[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeEntry | null>(null);
  const [chosenRole, setChosenRole]     = useState<Role | null>(null);

  // Provider form
  const [cpu, setCpu]         = useState("4");
  const [ram, setRam]         = useState("8");
  const [storage, setStorage] = useState("500");
  const [priceSol, setPriceSol] = useState("0.001");

  // Client form
  const [reqCpu, setReqCpu] = useState("2");
  const [reqRam, setReqRam] = useState("4");
  const [paySol, setPaySol] = useState("0.001");
  const [spec, setSpec]     = useState(`{"image":"python:3.11-slim","cmd":"python -c 'print(2+2)'"}`);
  const [uploading, setUploading] = useState(false);

  const walletRef = useRef<PublicKey | null>(null);
  walletRef.current = wallet;

  const log = useCallback((kind: LogKind, text: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs(p => [{ kind, text, ts }, ...p].slice(0, 40));
  }, []);

  // ── On mount: restore session if wallet is still connected ───────────────────
  useEffect(() => {
    const w = (window as WalletW).solana;
    try {
      if (w?.publicKey) {
        setWallet(w.publicKey);
        const saved = localStorage.getItem("cn_role") as Role | null;
        if (saved) { setRole(saved); setChosenRole(saved); }
      }
    } catch { /* wallet unavailable */ }
    setMounted(true);
  }, []);

  useEffect(() => { localStorage.setItem("cn_role", role); }, [role]);

  function getProgram() {
    const w = (window as WalletW).solana;
    if (!w?.publicKey) throw new Error("Wallet no conectada");
    return new Program(IDL, new AnchorProvider(conn, w as never, { commitment: "confirmed" }));
  }

  // ── Data refresh ───────────────────────────────────────────────────────────
  async function refreshBalance(pk: PublicKey) { setBalance(await conn.getBalance(pk)); }

  async function refreshNetwork() {
    try {
      const net = await (getProgram().account as never as {
        networkState: { fetch(k: PublicKey): Promise<{ admin: PublicKey; totalNodes: number; totalJobs: BN }> }
      }).networkState.fetch(networkPDA());
      setNetwork({ admin: net.admin.toBase58(), totalNodes: net.totalNodes, totalJobs: net.totalJobs.toNumber() });
    } catch { /* not initialized */ }
  }

  async function refreshNode(pk: PublicKey) {
    try {
      const n = await (getProgram().account as never as {
        nodeAccount: { fetch(k: PublicKey): Promise<{
          cpuCores: number; ramGb: number; storageGb: number; pricePerJob: BN;
          jobsCompleted: BN; activeJobs: number; reputation: number; isActive: boolean;
        }> }
      }).nodeAccount.fetch(nodePDA(pk));
      setMyNode({ cpu: n.cpuCores, ram: n.ramGb, storage: n.storageGb,
        price: sol(n.pricePerJob.toNumber()), reputation: n.reputation,
        jobs: n.jobsCompleted.toNumber(), active: n.activeJobs, isActive: n.isActive });
    } catch { setMyNode(null); }
  }

  async function refreshAll() {
    const pk = walletRef.current; if (!pk) return;
    try {
      const p = getProgram();
      const nodeAccs = await (p.account as never as {
        nodeAccount: { all(): Promise<{ account: {
          owner: PublicKey; cpuCores: number; ramGb: number; storageGb: number;
          pricePerJob: BN; jobsCompleted: BN; reputation: number; isActive: boolean;
        }}[]> }
      }).nodeAccount.all();
      setAllNodes(nodeAccs.map(({ account: n }) => ({
        owner: n.owner.toBase58(), cpu: n.cpuCores, ram: n.ramGb, storage: n.storageGb,
        price: sol(n.pricePerJob.toNumber()), reputation: n.reputation,
        jobs: n.jobsCompleted.toNumber(), isActive: n.isActive,
      })));

      const jobAccs = await (p.account as never as {
        jobAccount: { all(): Promise<{ account: {
          client: PublicKey; provider: PublicKey; jobId: BN; requiredCpu: number;
          requiredRam: number; payment: BN; status: Record<string, unknown>; spec: string; result: string;
        }}[]> }
      }).jobAccount.all();

      const entries: JobEntry[] = jobAccs.map(({ account: j }) => ({
        jobId: j.jobId.toNumber(), client: j.client.toBase58(), provider: j.provider.toBase58(),
        payment: sol(j.payment.toNumber()), cpu: j.requiredCpu, ram: j.requiredRam,
        status: Object.keys(j.status)[0], spec: j.spec, result: j.result,
      }));
      const me = pk.toBase58();
      setMyJobs(entries.filter(j => j.client === me));
      setProviderJobs(entries.filter(j => j.provider === me));
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (!wallet) return;
    refreshBalance(wallet); refreshNetwork(); refreshNode(wallet); refreshAll();
    const id = setInterval(() => {
      if (!walletRef.current) return;
      refreshBalance(walletRef.current); refreshNetwork();
      refreshNode(walletRef.current); refreshAll();
    }, 8000);
    return () => clearInterval(id);
  }, [wallet]); // eslint-disable-line

  // ── Actions ────────────────────────────────────────────────────────────────
  async function connect() {
    try {
      const w = (window as WalletW).solana;
      if (!w) throw new Error("Instala Backpack o Phantom");
      const res = await w.connect();
      setWallet(res.publicKey);
      log("ok", `Conectado: ${res.publicKey.toBase58()}`);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function airdrop() {
    if (!wallet) return;
    try {
      await conn.confirmTransaction(await conn.requestAirdrop(wallet, 2 * LAMPORTS_PER_SOL));
      await refreshBalance(wallet); log("ok", "Airdrop de 2 SOL recibido");
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function initialize() {
    try {
      await (getProgram().methods as never as { initialize(): { accounts(a: object): { rpc(): Promise<string> } } })
        .initialize().accounts({ admin: wallet!, networkState: networkPDA() }).rpc();
      log("ok", "Red inicializada"); await refreshNetwork();
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function registerNode() {
    try {
      await (getProgram().methods as never as { registerNode(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .registerNode(Number(cpu), Number(ram), Number(storage), new BN(lamps(priceSol)))
        .accounts({ provider: wallet!, nodeAccount: nodePDA(wallet!), networkState: networkPDA() }).rpc();
      log("ok", "Nodo registrado");
      await Promise.all([refreshNode(wallet!), refreshNetwork(), refreshAll()]);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function submitJob() {
    if (!selectedNode) { log("err", "Selecciona un nodo del marketplace"); return; }
    try {
      const prov = new PublicKey(selectedNode.owner);
      const jid  = myJobs.length > 0 ? Math.max(...myJobs.map(j => j.jobId)) + 1 : 1;
      await (getProgram().methods as never as { submitJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .submitJob(new BN(jid), Number(reqCpu), Number(reqRam), new BN(lamps(paySol)), spec)
        .accounts({ client: wallet!, providerNode: nodePDA(prov), jobAccount: jobPDA(wallet!, jid) }).rpc();
      log("ok", `Job #${jid} enviado — ${paySol} SOL en escrow`);
      await Promise.all([refreshBalance(wallet!), refreshAll()]);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function acceptJob(j: JobEntry) {
    try {
      const client = new PublicKey(j.client);
      await (getProgram().methods as never as { acceptJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .acceptJob(new BN(j.jobId))
        .accounts({ provider: wallet!, nodeAccount: nodePDA(wallet!), jobAccount: jobPDA(client, j.jobId) }).rpc();
      log("ok", `Job #${j.jobId} aceptado`);
      await Promise.all([refreshNode(wallet!), refreshAll()]);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function completeJob(j: JobEntry) {
    try {
      const client = new PublicKey(j.client);
      await (getProgram().methods as never as { completeJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .completeJob(new BN(j.jobId), "")
        .accounts({ provider: wallet!, client, nodeAccount: nodePDA(wallet!), jobAccount: jobPDA(client, j.jobId), networkState: networkPDA() }).rpc();
      log("ok", `Job #${j.jobId} completado — pago liberado`);
      await Promise.all([refreshBalance(wallet!), refreshNode(wallet!), refreshNetwork(), refreshAll()]);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function cancelJob(j: JobEntry) {
    try {
      await (getProgram().methods as never as { cancelJob(...a: unknown[]): { accounts(a: object): { rpc(): Promise<string> } } })
        .cancelJob(new BN(j.jobId))
        .accounts({ client: wallet!, jobAccount: jobPDA(wallet!, j.jobId) }).rpc();
      log("ok", `Job #${j.jobId} cancelado — reembolso enviado`);
      await Promise.all([refreshBalance(wallet!), refreshAll()]);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function deregisterNode() {
    try {
      await (getProgram().methods as never as { deregisterNode(): { accounts(a: object): { rpc(): Promise<string> } } })
        .deregisterNode()
        .accounts({ provider: wallet!, nodeAccount: nodePDA(wallet!), networkState: networkPDA() }).rpc();
      log("ok", "Nodo eliminado"); setMyNode(null);
      await Promise.all([refreshNetwork(), refreshAll()]);
    } catch (e: unknown) { log("err", String(e)); }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch("http://localhost:5001/api/v0/add?pin=true", { method: "POST", body: form })
        .catch(() => { throw new Error("IPFS daemon no está corriendo. Ejecuta: ipfs daemon"); });
      if (!res.ok) throw new Error("IPFS upload fallido");
      const cid = ((await res.json()) as { Hash: string }).Hash;
      log("ok", `Archivo subido → ${cid}`);
      try {
        const cur = JSON.parse(spec) as Record<string, unknown>;
        setSpec(JSON.stringify({ ...cur, input_cid: cid, output_path: "/output" }));
      } catch { setSpec(JSON.stringify({ image: "alpine", cmd: "ls /input", input_cid: cid, output_path: "/output" })); }
    } catch (e: unknown) { log("err", String(e)); }
    finally { setUploading(false); }
  }

  const isIpfs = (s: string) => s.startsWith("ipfs://") || s.startsWith("Qm") || s.startsWith("bafy");
  const ipfsUrl = (s: string) => `https://ipfs.io/ipfs/${s.replace("ipfs://", "")}`;

  const stars = (rep: number) => {
    const n = Math.round(rep / 20);
    return "★".repeat(n) + "☆".repeat(5 - n);
  };

  const activeNodes = allNodes.filter(n => n.isActive);
  const pendingProvJobs = providerJobs.filter(j => j.status === "pending" || j.status === "accepted");

  async function connectWithRole(r: Role) {
    setChosenRole(r);
    setRole(r);
    try {
      const w = (window as WalletW).solana;
      if (!w) throw new Error("Instala Backpack o Phantom");
      const res = await w.connect();
      setWallet(res.publicKey);
      log("ok", `Conectado: ${res.publicKey.toBase58()}`);
    } catch (e: unknown) { log("err", String(e)); setChosenRole(null); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!mounted) return (
    <div style={{ fontFamily: C.sans, background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#000" }}>C</div>
        <div style={{ color: C.muted, fontSize: 14 }}>Cargando…</div>
      </div>
    </div>
  );

  if (!wallet) return <Welcome onChoose={connectWithRole} choosing={chosenRole} />;

  return (
    <div style={{ fontFamily: C.sans, background: C.bg, color: C.text, minHeight: "100vh" }}>

      {/* ── Header ── */}
      <header style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "0 32px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: "bold", color: "#000",
          }}>C</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: "-0.3px" }}>CoreNet</div>
            <div style={{ fontSize: 11, color: C.muted }}>Distributed Computing Network</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {network && (
            <div style={{ display: "flex", gap: 20, marginRight: 8 }}>
              <Chip label="Nodos" value={String(network.totalNodes)} color={C.accent} />
              <Chip label="Jobs" value={String(network.totalJobs)} color={C.blue} />
            </div>
          )}
          {wallet && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 12px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.accent }}>{sol(balance)} SOL</span>
              <span style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>{short(wallet.toBase58())}</span>
            </div>
          )}
          <button onClick={() => { setWallet(null); setChosenRole(null); }} style={{
            background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "6px 12px", cursor: "pointer", color: C.muted, fontFamily: C.sans, fontSize: 12,
          }}>
            {role === "provider" ? "⚙ Proveedor" : "💼 Cliente"} <span style={{ color: C.dim }}>· cambiar</span>
          </button>
          <GhostBtn onClick={airdrop} disabled={!wallet}>+ Airdrop</GhostBtn>
          <PrimaryBtn onClick={connect}>{wallet ? "✓ Conectado" : "Conectar Wallet"}</PrimaryBtn>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {/* Init banner */}
        {!network && wallet && (
          <div style={{ background: "#161b22", border: `1px solid ${C.yellow}44`, borderRadius: 10, padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.yellow }}>Red no inicializada</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Eres el admin — inicializa la red para comenzar.</div>
            </div>
            <GhostBtn onClick={initialize}>Inicializar red</GhostBtn>
          </div>
        )}


        {/* ══ CLIENT VIEW ══ */}
        {role === "client" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Marketplace */}
            <Section title="Marketplace" subtitle={`${activeNodes.length} nodo${activeNodes.length !== 1 ? "s" : ""} disponible${activeNodes.length !== 1 ? "s" : ""}`}>
              {activeNodes.length === 0 ? (
                <EmptyState icon="🖥️" text="No hay nodos activos en la red." />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                  {activeNodes.map(n => {
                    const sel = selectedNode?.owner === n.owner;
                    return (
                      <NodeCard key={n.owner} node={n} selected={sel} stars={stars(n.reputation)}
                        onClick={() => setSelectedNode(sel ? null : n)} />
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Submit + My jobs */}
            <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 24 }}>

              {/* Submit */}
              <Section title="Solicitar cómputo" subtitle="">
                {selectedNode ? (
                  <div style={{ background: `${C.accent}11`, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.muted }}>Nodo seleccionado</div>
                      <div style={{ fontFamily: C.mono, fontSize: 13, color: C.accent, marginTop: 2 }}>{short(selectedNode.owner)}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{selectedNode.cpu} cores · {selectedNode.ram}GB · {selectedNode.price} SOL/job</div>
                    </div>
                    <button onClick={() => setSelectedNode(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}>×</button>
                  </div>
                ) : (
                  <div style={{ background: `${C.border}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: C.muted, textAlign: "center" }}>
                    ← Selecciona un nodo del marketplace
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
                  <Input label="CPU"     value={reqCpu}  onChange={setReqCpu} suffix="cores" />
                  <Input label="RAM"     value={reqRam}  onChange={setReqRam} suffix="GB" />
                </div>
                <Input label="Pago" value={paySol} onChange={setPaySol} suffix="SOL" />

                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Job Spec</label>
                    <label style={{
                      fontSize: 12, color: uploading ? C.dim : C.blue,
                      cursor: uploading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 4,
                    }}>
                      {uploading ? "Subiendo…" : "↑ Subir a IPFS"}
                      <input type="file" style={{ display: "none" }} onChange={handleFileUpload} disabled={uploading} />
                    </label>
                  </div>
                  <textarea value={spec} onChange={e => setSpec(e.target.value)} rows={4}
                    style={{
                      width: "100%", padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`,
                      color: C.blue, fontFamily: C.mono, fontSize: 12, borderRadius: 8,
                      boxSizing: "border-box", resize: "vertical", outline: "none", lineHeight: 1.6,
                    }} />
                </div>

                <PrimaryBtn onClick={submitJob} disabled={!wallet || !selectedNode} full>
                  Enviar job — Bloquear {paySol} SOL
                </PrimaryBtn>
              </Section>

              {/* My jobs */}
              <Section title="Mis Jobs" subtitle={`${myJobs.length} total`}>
                {myJobs.length === 0 ? (
                  <EmptyState icon="📋" text="Aún no has enviado ningún job." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {[...myJobs].reverse().map(j => (
                      <JobCard key={j.jobId} job={j} isIpfs={isIpfs} ipfsUrl={ipfsUrl}>
                        {j.status === "pending" && (
                          <DangerBtn onClick={() => cancelJob(j)} disabled={!wallet}>Cancelar</DangerBtn>
                        )}
                      </JobCard>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        )}

        {/* ══ PROVIDER VIEW ══ */}
        {role === "provider" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>

              {/* My node card */}
              <Section title="Mi Nodo" subtitle="">
                {myNode ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: myNode.isActive ? C.accent : C.red, boxShadow: `0 0 8px ${myNode.isActive ? C.accent : C.red}` }} />
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{myNode.isActive ? "Activo" : "Inactivo"}</span>
                      <span style={{ color: C.yellow, fontSize: 14 }}>{stars(myNode.reputation)}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{myNode.reputation}/100</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                      <StatBox label="CPU"     value={`${myNode.cpu}`}     unit="cores" color={C.blue} />
                      <StatBox label="RAM"     value={`${myNode.ram}`}     unit="GB"    color={C.purple} />
                      <StatBox label="Storage" value={`${myNode.storage}`} unit="GB"    color={C.muted} />
                      <StatBox label="Precio"  value={myNode.price}        unit="SOL"   color={C.accent} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px" }}>
                        <div style={{ fontSize: 24, fontWeight: 700 }}>{myNode.jobs}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>Jobs completados</div>
                      </div>
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px" }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: myNode.active > 0 ? C.blue : C.text }}>{myNode.active}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>Jobs activos ahora</div>
                      </div>
                    </div>
                    <DangerBtn onClick={deregisterNode} disabled={myNode.active > 0}>
                      {myNode.active > 0 ? `No puedes salir (${myNode.active} job${myNode.active > 1 ? "s" : ""} activo${myNode.active > 1 ? "s" : ""})` : "Desregistrar nodo"}
                    </DangerBtn>
                  </div>
                ) : (
                  <EmptyState icon="🖥️" text="Aún no tienes un nodo registrado." />
                )}
              </Section>

              {/* Register form */}
              <Section title={myNode ? "Actualizar Nodo" : "Registrar Nodo"} subtitle="">
                <Input label="CPU cores"    value={cpu}      onChange={setCpu} suffix="cores" />
                <Input label="RAM"          value={ram}      onChange={setRam} suffix="GB" />
                <Input label="Storage"      value={storage}  onChange={setStorage} suffix="GB" />
                <Input label="Precio/job"   value={priceSol} onChange={setPriceSol} suffix="SOL" />
                <PrimaryBtn onClick={registerNode} disabled={!wallet} full>
                  {myNode ? "Actualizar nodo" : "Registrar nodo"}
                </PrimaryBtn>
              </Section>
            </div>

            {/* Incoming jobs */}
            <Section title="Jobs Entrantes" subtitle={`${pendingProvJobs.length} requieren atención`}>
              {pendingProvJobs.length === 0 ? (
                <EmptyState icon="✨" text="Sin jobs pendientes. Tu nodo está libre." />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        {["Job", "Cliente", "Estado", "Pago", "Recursos", "Spec", ""].map(h => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: C.muted, fontWeight: 600, fontSize: 12 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pendingProvJobs.map(j => (
                        <tr key={j.jobId} style={{ borderBottom: `1px solid ${C.borderSub}` }}>
                          <td style={{ padding: "12px 14px", fontWeight: 700, color: C.accent }}>#{j.jobId}</td>
                          <td style={{ padding: "12px 14px", fontFamily: C.mono, fontSize: 12, color: C.muted }}>{short(j.client)}</td>
                          <td style={{ padding: "12px 14px" }}><StatusBadge status={j.status} /></td>
                          <td style={{ padding: "12px 14px", fontWeight: 600 }}>{j.payment} SOL</td>
                          <td style={{ padding: "12px 14px", color: C.muted }}>{j.cpu}c / {j.ram}GB</td>
                          <td style={{ padding: "12px 14px", maxWidth: 220 }}>
                            <div style={{ fontFamily: C.mono, fontSize: 11, color: C.blue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.spec}</div>
                          </td>
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ display: "flex", gap: 8 }}>
                              {j.status === "pending" && <GhostBtn onClick={() => acceptJob(j)} disabled={!wallet}>Aceptar</GhostBtn>}
                              {j.status === "accepted" && <PrimaryBtn onClick={() => completeJob(j)} disabled={!wallet}>Completar</PrimaryBtn>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Completed jobs history */}
              {providerJobs.filter(j => j.status === "completed").length > 0 && (
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.borderSub}` }}>
                  <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 12 }}>HISTORIAL COMPLETADOS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {providerJobs.filter(j => j.status === "completed").map(j => (
                      <div key={j.jobId} style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 14px", background: C.card, borderRadius: 8, fontSize: 13 }}>
                        <span style={{ color: C.accent, fontWeight: 700, minWidth: 48 }}>#{j.jobId}</span>
                        <StatusBadge status={j.status} />
                        <span style={{ color: C.muted }}>de {short(j.client)}</span>
                        <span style={{ fontWeight: 600, marginLeft: "auto" }}>{j.payment} SOL</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          </div>
        )}

        {/* ── Activity log ── */}
        <div style={{ marginTop: 32, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>ACTIVIDAD</span>
            <button onClick={() => setLogs([])} style={{ fontSize: 12, color: C.dim, background: "none", border: "none", cursor: "pointer" }}>Limpiar</button>
          </div>
          <div style={{ padding: "8px 16px", maxHeight: 160, overflowY: "auto", fontFamily: C.mono, fontSize: 12 }}>
            {logs.length === 0 && <div style={{ color: C.dim, padding: "8px 0" }}>Sin actividad…</div>}
            {logs.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "4px 0", borderBottom: `1px solid ${C.borderSub}` }}>
                <span style={{ color: C.dim, minWidth: 70 }}>{l.ts}</span>
                <span style={{ color: l.kind === "ok" ? C.accent : l.kind === "err" ? C.red : C.blue }}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Welcome screen ────────────────────────────────────────────────────────────
function Welcome({ onChoose, choosing }: { onChoose(r: Role): void; choosing: Role | null }) {
  const [hov, setHov] = useState<Role | null>(null);

  const roles: { id: Role; icon: string; title: string; subtitle: string; perks: string[] }[] = [
    {
      id: "provider",
      icon: "🖥️",
      title: "Soy Proveedor",
      subtitle: "Tengo hardware disponible y quiero generar ingresos.",
      perks: ["Registra tu PC con sus specs reales", "Recibe SOL por cada job completado", "Tú decides el precio por job", "Reputación on-chain que crece con el tiempo"],
    },
    {
      id: "client",
      icon: "⚡",
      title: "Soy Cliente",
      subtitle: "Necesito cómputo bajo demanda sin pagar precios de nube.",
      perks: ["Accede a nodos reales de la red", "Pago en SOL bloqueado en escrow", "Tu dinero solo se libera al completar", "Cancela en cualquier momento si está pendiente"],
    },
  ];

  return (
    <div style={{
      fontFamily: C.sans, background: C.bg, color: C.text, minHeight: "100vh",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "40px 24px",
    }}>
      {/* Logo */}
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, fontWeight: 900, color: "#000",
          margin: "0 auto 20px", boxShadow: `0 0 40px ${C.accent}44`,
        }}>C</div>
        <h1 style={{ margin: "0 0 10px", fontSize: 40, fontWeight: 800, letterSpacing: "-1px", color: C.text }}>
          Bienvenido a <span style={{ color: C.accent }}>CoreNet</span>
        </h1>
        <p style={{ margin: 0, fontSize: 17, color: C.muted, maxWidth: 520, lineHeight: 1.6 }}>
          El marketplace descentralizado de cómputo. Conecta tu hardware a la red y gana SOL,
          o accede a poder de procesamiento sin depender de AWS, Google o Azure.
        </p>
      </div>

      {/* Role cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, width: "100%", maxWidth: 720, marginBottom: 40 }}>
        {roles.map(r => {
          const isHov  = hov === r.id;
          const isSel  = choosing === r.id;
          return (
            <div
              key={r.id}
              onClick={() => !choosing && onChoose(r.id)}
              onMouseEnter={() => setHov(r.id)}
              onMouseLeave={() => setHov(null)}
              style={{
                background: isSel ? `${C.accent}12` : isHov ? C.cardHov : C.card,
                border: `1.5px solid ${isSel ? C.accent : isHov ? C.border : C.borderSub}`,
                borderRadius: 16, padding: 28,
                cursor: choosing ? "wait" : "pointer",
                transition: "all 0.2s",
                boxShadow: isSel ? `0 0 30px ${C.accent}22` : isHov ? "0 4px 20px rgba(0,0,0,.3)" : "none",
              }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>{r.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{r.title}</div>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 20, lineHeight: 1.5 }}>{r.subtitle}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {r.perks.map(p => (
                  <li key={p} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: C.muted, marginBottom: 8 }}>
                    <span style={{ color: C.accent, marginTop: 1, flexShrink: 0 }}>✓</span>
                    {p}
                  </li>
                ))}
              </ul>
              <div style={{
                marginTop: 24, padding: "10px 0", borderRadius: 8, textAlign: "center",
                background: isSel || isHov ? C.accent : `${C.accent}18`,
                color: isSel || isHov ? "#000" : C.accent,
                fontWeight: 700, fontSize: 14, transition: "all 0.2s",
              }}>
                {isSel ? "Conectando wallet…" : `Continuar como ${r.id === "provider" ? "Proveedor" : "Cliente"}`}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: C.dim, textAlign: "center" }}>
        Puedes cambiar de rol en cualquier momento dentro de la app.
      </p>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{title}</h2>
        {subtitle && <span style={{ fontSize: 12, color: C.muted }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function NodeCard({ node, selected, stars, onClick }: { node: NodeEntry; selected: boolean; stars: string; onClick(): void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: selected ? `${C.accent}0d` : hov ? C.cardHov : C.card,
        border: `1px solid ${selected ? C.accent : hov ? C.border : C.borderSub}`,
        borderRadius: 10, padding: 16, cursor: "pointer", transition: "all 0.15s",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: C.mono, fontSize: 12, color: C.muted }}>{short(node.owner)}</div>
          <div style={{ color: C.yellow, fontSize: 13, marginTop: 2 }}>{stars} <span style={{ color: C.muted, fontWeight: 400 }}>{node.reputation}/100</span></div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{node.price}</div>
          <div style={{ fontSize: 11, color: C.muted }}>SOL / job</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[["CPU", `${node.cpu} cores`, C.blue], ["RAM", `${node.ram} GB`, C.purple], ["Disk", `${node.storage} GB`, C.muted]].map(([label, value, color]) => (
          <div key={label} style={{ background: `${C.bg}88`, borderRadius: 6, padding: "6px 10px" }}>
            <div style={{ fontSize: 10, color: C.dim }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: color as string }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, textAlign: "center", fontWeight: 600, color: selected ? C.accent : C.muted }}>
        {selected ? "✓ Seleccionado" : "Seleccionar nodo"}
      </div>
    </div>
  );
}

function JobCard({ job, isIpfs, ipfsUrl, children }: { job: JobEntry; isIpfs(s: string): boolean; ipfsUrl(s: string): string; children?: React.ReactNode }) {
  const st = STATUS[job.status] ?? { color: C.muted, label: job.status, icon: "?" };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.borderSub}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Job #{job.jobId}</span>
          <StatusBadge status={job.status} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.accent }}>{job.payment} SOL</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: C.muted, marginBottom: 12 }}>
        <div>Proveedor: <span style={{ color: C.text, fontFamily: C.mono }}>{short(job.provider)}</span></div>
        <div>Recursos: <span style={{ color: C.text }}>{job.cpu} cores · {job.ram} GB RAM</span></div>
      </div>
      {job.result && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>OUTPUT</div>
          {isIpfs(job.result) ? (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontFamily: C.mono, fontSize: 11, color: C.blue, marginBottom: 8, wordBreak: "break-all" }}>{job.result}</div>
              <a href={ipfsUrl(job.result)} target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: C.accent, textDecoration: "none", background: `${C.accent}15`, padding: "4px 10px", borderRadius: 6 }}>
                ↗ Abrir en IPFS
              </a>
            </div>
          ) : (
            <pre style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", margin: 0, fontFamily: C.mono, fontSize: 12, color: C.accent, whiteSpace: "pre-wrap" }}>
              {job.result}
            </pre>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const st = STATUS[status] ?? { color: C.muted, label: status, icon: "?" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: `${st.color}18`, color: st.color,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
    }}>{st.icon} {st.label}</span>
  );
}

function StatBox({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted }}>{unit}</div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
    </div>
  );
}

function Input({ label, value, onChange, suffix }: { label: string; value: string; onChange(v: string): void; suffix?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 5 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input value={value} onChange={e => onChange(e.target.value)}
          style={{
            width: "100%", padding: suffix ? "9px 48px 9px 12px" : "9px 12px",
            background: C.card, border: `1px solid ${C.border}`, color: C.text,
            fontFamily: C.sans, fontSize: 14, borderRadius: 8, boxSizing: "border-box", outline: "none",
          }} />
        {suffix && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.dim }}>{suffix}</span>}
      </div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  );
}

function PrimaryBtn({ children, onClick, disabled, full }: { children: React.ReactNode; onClick(): void; disabled?: boolean; full?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        padding: "10px 18px", border: "none", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? C.dim : h ? "#45d95a" : C.accent,
        color: "#000", fontFamily: C.sans, fontSize: 13, fontWeight: 700,
        opacity: disabled ? 0.5 : 1, transition: "background 0.15s", width: full ? "100%" : undefined,
      }}>{children}</button>
  );
}

function GhostBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick(): void; disabled?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        padding: "8px 16px", border: `1px solid ${C.border}`, borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        background: h ? C.card : "transparent", color: disabled ? C.dim : C.text,
        fontFamily: C.sans, fontSize: 13, fontWeight: 500,
        opacity: disabled ? 0.5 : 1, transition: "background 0.15s",
      }}>{children}</button>
  );
}

function DangerBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick(): void; disabled?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        padding: "8px 16px", border: `1px solid ${C.red}55`, borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        background: h ? `${C.red}22` : `${C.red}11`, color: disabled ? C.dim : C.red,
        fontFamily: C.sans, fontSize: 13, fontWeight: 500,
        opacity: disabled ? 0.5 : 1, transition: "background 0.15s",
      }}>{children}</button>
  );
}
