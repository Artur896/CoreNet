use anchor_lang::prelude::*;
use crate::errors::CoreNetError;
use crate::state::{JobAccount, JobStatus, NetworkState, NodeAccount};

#[derive(Accounts)]
pub struct CompleteJob<'info> {
    /// Receives the escrowed payment.
    #[account(mut)]
    pub provider: Signer<'info>,

    /// Receives the rent lamports when job_account is closed.
    /// CHECK: verified via has_one = client on job_account
    #[account(mut)]
    pub client: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"node", provider.key().as_ref()],
        bump = node_account.bump,
        constraint = node_account.owner == provider.key() @ CoreNetError::Unauthorized,
        constraint = node_account.is_active @ CoreNetError::NodeNotActive,
    )]
    pub node_account: Account<'info, NodeAccount>,

    /// Closed to `client` after the instruction; remaining lamports (rent) return to client.
    #[account(
        mut,
        close = client,
        seeds = [
            b"job",
            job_account.client.as_ref(),
            &job_account.job_id.to_le_bytes(),
        ],
        bump = job_account.bump,
        has_one = client @ CoreNetError::Unauthorized,
        constraint = job_account.provider == provider.key() @ CoreNetError::Unauthorized,
        constraint = job_account.status == JobStatus::Accepted @ CoreNetError::InvalidJobStatus,
    )]
    pub job_account: Account<'info, JobAccount>,

    #[account(
        mut,
        seeds = [b"network"],
        bump = network_state.bump,
    )]
    pub network_state: Account<'info, NetworkState>,
}

pub fn handler(ctx: Context<CompleteJob>) -> Result<()> {
    let payment = ctx.accounts.job_account.payment;

    // Update job status before account is closed.
    ctx.accounts.job_account.status = JobStatus::Completed;

    // Update node statistics.
    ctx.accounts.node_account.jobs_completed += 1;
    ctx.accounts.node_account.active_jobs =
        ctx.accounts.node_account.active_jobs.saturating_sub(1);
    if ctx.accounts.node_account.reputation < 100 {
        ctx.accounts.node_account.reputation += 1;
    }

    ctx.accounts.network_state.total_jobs += 1;

    // Release escrow: transfer payment from job PDA to provider.
    // After this, job_account holds only rent lamports, which Anchor returns
    // to `client` via the `close = client` constraint.
    **ctx
        .accounts
        .job_account
        .to_account_info()
        .try_borrow_mut_lamports()? -= payment;
    **ctx
        .accounts
        .provider
        .to_account_info()
        .try_borrow_mut_lamports()? += payment;

    Ok(())
}
