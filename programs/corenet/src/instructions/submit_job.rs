use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::errors::CoreNetError;
use crate::state::{JobAccount, JobStatus, NodeAccount};

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct SubmitJob<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    /// The provider node the client is targeting; must be active.
    #[account(
        seeds = [b"node", provider_node.owner.as_ref()],
        bump = provider_node.bump,
        constraint = provider_node.is_active @ CoreNetError::NodeNotActive,
    )]
    pub provider_node: Account<'info, NodeAccount>,

    #[account(
        init,
        payer = client,
        space = JobAccount::SPACE,
        seeds = [b"job", client.key().as_ref(), &job_id.to_le_bytes()],
        bump,
    )]
    pub job_account: Account<'info, JobAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SubmitJob>,
    job_id: u64,
    required_cpu: u8,
    required_ram: u16,
    payment: u64,
) -> Result<()> {
    require!(payment > 0, CoreNetError::ZeroPayment);

    // Lock payment in the job PDA as escrow (separate from rent already paid via init).
    system_program::transfer(
        CpiContext::new(
            system_program::ID,
            system_program::Transfer {
                from: ctx.accounts.client.to_account_info(),
                to: ctx.accounts.job_account.to_account_info(),
            },
        ),
        payment,
    )?;

    let job = &mut ctx.accounts.job_account;
    job.client = ctx.accounts.client.key();
    job.provider = ctx.accounts.provider_node.owner;
    job.job_id = job_id;
    job.required_cpu = required_cpu;
    job.required_ram = required_ram;
    job.payment = payment;
    job.status = JobStatus::Pending;
    job.bump = ctx.bumps.job_account;

    Ok(())
}
