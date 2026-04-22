use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// The #[program] macro generates `pub use crate::__client_accounts_<name>::*`
// expecting those modules at the crate root. Re-export them from their
// sub-modules so Anchor's generated `accounts` mod compiles correctly.
pub(crate) use instructions::accept_job::__client_accounts_accept_job;
pub(crate) use instructions::cancel_job::__client_accounts_cancel_job;
pub(crate) use instructions::complete_job::__client_accounts_complete_job;
pub(crate) use instructions::deregister_node::__client_accounts_deregister_node;
pub(crate) use instructions::initialize::__client_accounts_initialize;
pub(crate) use instructions::register_node::__client_accounts_register_node;
pub(crate) use instructions::submit_job::__client_accounts_submit_job;

// Replace with the output of `anchor keys generate` before deploying.
declare_id!("FM7AiquU7fx1Ng9W5QGwQLhsjwZfAa7LE7K3Tr4baskQ");

#[program]
pub mod corenet {
    use super::*;

    /// Creates the global NetworkState PDA. Call once from the admin wallet.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Registers a provider node with hardware specs and pricing.
    pub fn register_node(
        ctx: Context<RegisterNode>,
        cpu_cores: u8,
        ram_gb: u16,
        storage_gb: u32,
        price_per_job: u64,
    ) -> Result<()> {
        instructions::register_node::handler(ctx, cpu_cores, ram_gb, storage_gb, price_per_job)
    }

    /// Client submits a compute job targeting a specific provider node.
    /// Payment (in lamports) is locked in the job PDA as escrow.
    pub fn submit_job(
        ctx: Context<SubmitJob>,
        job_id: u64,
        required_cpu: u8,
        required_ram: u16,
        payment: u64,
    ) -> Result<()> {
        instructions::submit_job::handler(ctx, job_id, required_cpu, required_ram, payment)
    }

    /// Provider accepts a Pending job after validating resource availability.
    /// `job_id` is used client-side to derive the job PDA; the on-chain check
    /// uses self-referential seeds from the stored account data.
    pub fn accept_job(ctx: Context<AcceptJob>, _job_id: u64) -> Result<()> {
        instructions::accept_job::handler(ctx)
    }

    /// Provider marks the job Completed, releases payment from escrow,
    /// and returns the rent to the client.
    pub fn complete_job(ctx: Context<CompleteJob>, _job_id: u64) -> Result<()> {
        instructions::complete_job::handler(ctx)
    }

    /// Client cancels a Pending job and receives a full refund (rent + payment).
    pub fn cancel_job(ctx: Context<CancelJob>, _job_id: u64) -> Result<()> {
        instructions::cancel_job::handler(ctx)
    }

    /// Provider closes their node and recovers the rent. Fails if jobs are in flight.
    pub fn deregister_node(ctx: Context<DeregisterNode>) -> Result<()> {
        instructions::deregister_node::handler(ctx)
    }
}
