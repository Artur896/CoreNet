use anchor_lang::prelude::*;
use crate::errors::CoreNetError;
use crate::state::{JobAccount, JobStatus, NodeAccount};

#[derive(Accounts)]
pub struct AcceptJob<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [b"node", provider.key().as_ref()],
        bump = node_account.bump,
        constraint = node_account.owner == provider.key() @ CoreNetError::Unauthorized,
        constraint = node_account.is_active @ CoreNetError::NodeNotActive,
    )]
    pub node_account: Account<'info, NodeAccount>,

    /// Seeds are verified against the data already stored in the account (self-referential).
    #[account(
        mut,
        seeds = [
            b"job",
            job_account.client.as_ref(),
            &job_account.job_id.to_le_bytes(),
        ],
        bump = job_account.bump,
        constraint = job_account.provider == provider.key() @ CoreNetError::Unauthorized,
        constraint = job_account.status == JobStatus::Pending @ CoreNetError::InvalidJobStatus,
    )]
    pub job_account: Account<'info, JobAccount>,
}

pub fn handler(ctx: Context<AcceptJob>) -> Result<()> {
    let job = &ctx.accounts.job_account;
    let node = &ctx.accounts.node_account;

    require!(
        node.cpu_cores >= job.required_cpu && node.ram_gb >= job.required_ram,
        CoreNetError::InsufficientResources
    );

    ctx.accounts.job_account.status = JobStatus::Accepted;
    ctx.accounts.node_account.active_jobs += 1;

    Ok(())
}
