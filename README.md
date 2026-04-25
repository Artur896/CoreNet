# CoreNet

**ES** · [EN](#english)

---

## Español

CoreNet es un marketplace descentralizado de cómputo construido sobre Solana. Cualquier persona con una PC potente puede ofrecer su hardware a la red y cobrar en SOL por cada trabajo completado. Los clientes acceden a poder de procesamiento sin depender de AWS, Google Cloud o Azure.

### El problema

El cómputo en la nube está monopolizado por tres empresas. Es caro, centralizado y requiere tarjeta de crédito, KYC y contratos. CoreNet elimina al intermediario.

### Cómo funciona

```
Cliente define el job (imagen Docker + comando + archivos vía IPFS)
    ↓
Pago en SOL queda bloqueado en escrow on-chain
    ↓
Proveedor acepta el job — su daemon lo ejecuta automáticamente
    ↓
Resultado guardado on-chain · Pago liberado al proveedor
```

El pago nunca lo toca nadie hasta que el job se completa. Si el cliente cancela antes de que sea aceptado, recupera todo.

### Casos de uso

| Caso | Ejemplo de spec |
|---|---|
| Script Python | `{"image":"python:3.11-slim","cmd":"python script.py"}` |
| Renderizado 3D | `{"image":"linuxserver/blender","cmd":"blender -b scene.blend -f 1","input_cid":"Qm..."}` |
| ML / GPU | `{"image":"pytorch/pytorch","cmd":"python train.py","gpu":true,"input_cid":"Qm..."}` |
| Transcodificación | `{"image":"jrottenberg/ffmpeg","cmd":"ffmpeg -i /input/video.mp4 /output/out.mp4","output_path":"/output"}` |
| CI/CD | `{"image":"node:20","cmd":"npm ci && npm test"}` |

### Seguridad y confianza

| Riesgo | Cómo lo maneja CoreNet |
|---|---|
| Proveedor no entrega | El cliente puede cancelar si el job sigue pendiente |
| Cliente no paga | El pago está bloqueado en escrow antes de aceptar |
| Proveedor acepta más de lo que puede | Validación on-chain de CPU y RAM |
| Mal actor reincidente | Reputación acumulada on-chain, visible para todos |

### Estructura del proyecto

```
CoreNet/
├── programs/corenet/src/     # Programa Anchor (Rust)
│   ├── lib.rs                # 7 instrucciones
│   ├── state/mod.rs          # NetworkState, NodeAccount, JobAccount
│   ├── instructions/         # Una instrucción por archivo
│   └── errors.rs
├── daemon/src/index.ts       # Daemon del proveedor (TypeScript)
└── app/src/App.tsx           # Frontend React + Vite
```

### Instalación y uso

**Requisitos**
- [Rust](https://rustup.rs/) + [Anchor 1.0.1](https://www.anchor-lang.com/docs/installation)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Node.js 18+](https://nodejs.org/)
- [Docker](https://docs.docker.com/get-docker/) (para el daemon del proveedor)
- [Kubo (IPFS)](https://dist.ipfs.tech/#kubo) (opcional, para jobs con archivos)

**1. Compilar y desplegar**

```bash
anchor build
solana-test-validator --reset
anchor deploy
```

**2. Frontend**

```bash
cd app
npm install
npm run dev
# Abre http://localhost:5173
```

**3. Daemon del proveedor** (en la PC que va a ejecutar los jobs)

```bash
cd daemon
npm install
npm start
# Usa la wallet de ~/.config/solana/id.json por defecto
# Variables de entorno opcionales:
# KEYPAIR=/ruta/keypair.json
# RPC=http://127.0.0.1:8899
# IPFS_API=http://localhost:5001
# TIMEOUT_S=120
```

**4. IPFS** (opcional, para jobs con archivos de entrada/salida)

```bash
ipfs init
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:5173"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["GET","POST","PUT"]'
ipfs daemon
```

### Programa on-chain

**Program ID:** `FM7AiquU7fx1Ng9W5QGwQLhsjwZfAa7LE7K3Tr4baskQ`

| Instrucción | Quién la llama | Qué hace |
|---|---|---|
| `initialize` | Admin | Crea el NetworkState global |
| `register_node` | Proveedor | Registra hardware con specs y precio |
| `submit_job` | Cliente | Bloquea SOL en escrow y crea el JobAccount |
| `accept_job` | Proveedor | Acepta un job pendiente |
| `complete_job` | Proveedor / Daemon | Libera el pago y guarda el resultado |
| `cancel_job` | Cliente | Cancela un job pendiente y reembolsa |
| `deregister_node` | Proveedor | Cierra el nodo (bloqueado si hay jobs activos) |

### Roadmap

- [ ] Sistema de disputes — arbitraje si el proveedor no entrega
- [ ] Expiración automática de jobs — reembolso por timeout
- [ ] Despliegue en Devnet / Mainnet
- [ ] Soporte multi-GPU declarado en el nodo
- [ ] SDK para integrar CoreNet en otras apps

---

## English

CoreNet is a decentralized compute marketplace built on Solana. Anyone with a powerful PC can offer their hardware to the network and earn SOL for every completed job. Clients get on-demand processing power without depending on AWS, Google Cloud, or Azure.

### The Problem

Cloud compute is monopolized by three companies. It's expensive, centralized, and requires a credit card, KYC, and contracts. CoreNet removes the middleman.

### How It Works

```
Client defines the job (Docker image + command + files via IPFS)
    ↓
SOL payment is locked in on-chain escrow
    ↓
Provider accepts the job — their daemon executes it automatically
    ↓
Result stored on-chain · Payment released to the provider
```

The payment is untouched until the job completes. If the client cancels before acceptance, they get a full refund.

### Use Cases

| Use case | Example spec |
|---|---|
| Python script | `{"image":"python:3.11-slim","cmd":"python script.py"}` |
| 3D rendering | `{"image":"linuxserver/blender","cmd":"blender -b scene.blend -f 1","input_cid":"Qm..."}` |
| ML / GPU | `{"image":"pytorch/pytorch","cmd":"python train.py","gpu":true,"input_cid":"Qm..."}` |
| Video transcoding | `{"image":"jrottenberg/ffmpeg","cmd":"ffmpeg -i /input/video.mp4 /output/out.mp4","output_path":"/output"}` |
| CI/CD | `{"image":"node:20","cmd":"npm ci && npm test"}` |

### Security and Trust

| Risk | How CoreNet handles it |
|---|---|
| Provider doesn't deliver | Client can cancel if the job is still pending |
| Client doesn't pay | Payment is locked in escrow before acceptance |
| Provider accepts beyond capacity | On-chain CPU and RAM validation |
| Repeat bad actors | On-chain reputation score, visible to everyone |

### Project Structure

```
CoreNet/
├── programs/corenet/src/     # Anchor program (Rust)
│   ├── lib.rs                # 7 instructions
│   ├── state/mod.rs          # NetworkState, NodeAccount, JobAccount
│   ├── instructions/         # One file per instruction
│   └── errors.rs
├── daemon/src/index.ts       # Provider daemon (TypeScript)
└── app/src/App.tsx           # React + Vite frontend
```

### Installation

**Requirements**
- [Rust](https://rustup.rs/) + [Anchor 1.0.1](https://www.anchor-lang.com/docs/installation)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Node.js 18+](https://nodejs.org/)
- [Docker](https://docs.docker.com/get-docker/) (for the provider daemon)
- [Kubo (IPFS)](https://dist.ipfs.tech/#kubo) (optional, for jobs with file I/O)

**1. Build and deploy**

```bash
anchor build
solana-test-validator --reset
anchor deploy
```

**2. Frontend**

```bash
cd app && npm install && npm run dev
# Open http://localhost:5173
```

**3. Provider daemon**

```bash
cd daemon && npm install && npm start
# Uses ~/.config/solana/id.json by default
# Optional env vars: KEYPAIR, RPC, IPFS_API, TIMEOUT_S
```

**4. IPFS** (optional)

```bash
ipfs init
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:5173"]'
ipfs daemon
```

### On-chain Program

**Program ID:** `FM7AiquU7fx1Ng9W5QGwQLhsjwZfAa7LE7K3Tr4baskQ`

| Instruction | Caller | What it does |
|---|---|---|
| `initialize` | Admin | Creates the global NetworkState |
| `register_node` | Provider | Registers hardware with specs and price |
| `submit_job` | Client | Locks SOL in escrow and creates the JobAccount |
| `accept_job` | Provider | Accepts a pending job |
| `complete_job` | Provider / Daemon | Releases payment and stores the result |
| `cancel_job` | Client | Cancels a pending job and refunds |
| `deregister_node` | Provider | Closes the node (blocked if jobs are active) |

### Roadmap

- [ ] Dispute system — arbitration if provider doesn't deliver
- [ ] Automatic job expiry — timeout-based refund
- [ ] Devnet / Mainnet deployment
- [ ] Multi-GPU support declared at the node level
- [ ] SDK for integrating CoreNet into other apps
