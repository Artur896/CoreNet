use anchor_lang::prelude::*;
use crate::errors::CoreNetError;
use crate::state::{JobAccount, JobStatus};

#[derive(Accounts)]
pub struct CancelJob<'info> {
    /// Must be the original submitter; receives full refund (rent + payment) via close.
    #[account(mut)]
    pub client: Signer<'info>,

    /// Closing to `client` returns all lamports (rent + escrowed payment).
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
        constraint = job_account.status == JobStatus::Pending @ CoreNetError::InvalidJobStatus,
    )]
    pub job_account: Account<'info, JobAccount>,
}

pub fn handler(ctx: Context<CancelJob>) -> Result<()> {
    ctx.accounts.job_account.status = JobStatus::Cancelled;
    Ok(())
}
