# CoreNet

Decentralized compute marketplace built on Solana. Anyone with a powerful PC can offer compute resources and earn SOL. Clients submit jobs with payment locked in escrow — providers execute and collect when done.

## The Problem

Cloud compute is monopolized by AWS, Google, and Azure. Expensive, centralized, and gatekept. CoreNet democratizes access to processing power by turning idle hardware into a permissionless compute market.

## How It Works

```
Client locks SOL in escrow  →  Provider accepts job  →  Job executes  →  Provider gets paid
```

No middleman. Trust is enforced by the Solana program — payment is only released when the provider marks the job complete.

## Program

**Network:** Localnet (Devnet/Mainnet deployment pending)  
**Program ID:** `FM7AiquU7fx1Ng9W5QGwQLhsjwZfAa7LE7K3Tr4baskQ`  
**Framework:** Anchor 1.0.1

### Accounts

| Account | Seeds | Description |
|---|---|---|
| `NetworkState` | `["network"]` | Global registry — tracks total nodes and jobs |
| `NodeAccount` | `["node", owner]` | Provider's hardware specs and pricing |
| `JobAccount` | `["job", client, job_id]` | Job metadata and SOL escrow |

### Instructions

| Instruction | Who calls it | What it does |
|---|---|---|
| `initialize` | Admin | Creates the NetworkState PDA |
| `register_node` | Provider | Registers hardware (CPU, RAM, storage, price) |
| `submit_job` | Client | Locks SOL in escrow and creates a JobAccount |
| `accept_job` | Provider | Accepts a pending job, marks it in-flight |
| `complete_job` | Provider | Releases escrow payment, closes the job |
| `cancel_job` | Client | Cancels a pending job, refunds the client |
| `deregister_node` | Provider | Closes the node (blocked if jobs are active) |

### Escrow Flow

```
submit_job  → rent (init) + payment (CPI transfer) locked in JobAccount
complete_job → payment transferred to provider, rent returned to client (close)
cancel_job  → full refund (payment + rent) returned to client (close)
```

## Project Structure

```
CoreNet/
├── Anchor.toml
├── Cargo.toml
├── programs/
│   └── corenet/
│       └── src/
│           ├── lib.rs
│           ├── errors.rs
│           ├── state/
│           │   └── mod.rs          # NetworkState, NodeAccount, JobAccount
│           └── instructions/
│               ├── mod.rs
│               ├── initialize.rs
│               ├── register_node.rs
│               ├── submit_job.rs
│               ├── accept_job.rs
│               ├── complete_job.rs
│               ├── cancel_job.rs
│               └── deregister_node.rs
└── app/                            # React + Vite frontend
    └── src/
        ├── main.tsx
        └── App.tsx
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor 1.0.1](https://www.anchor-lang.com/docs/installation)
- [Node.js](https://nodejs.org/)

### Build the program

```bash
anchor build
```

### Run a local validator

```bash
solana-test-validator
```

### Deploy

```bash
anchor deploy
```

### Run the frontend

```bash
cd app
npm install
npm run dev
```

Open `http://localhost:5173` and connect your wallet (Backpack or Phantom on Localnet).

## Roadmap

- [ ] Provider daemon — background process that watches the chain and executes real jobs
- [ ] Job spec format — Docker image + command stored on-chain
- [ ] Result verification — output hash submitted on completion
- [ ] Devnet deployment
- [ ] Mainnet launch
