use anchor_lang::prelude::*;
use crate::errors::CoreNetError;
use crate::state::{NetworkState, NodeAccount};

#[derive(Accounts)]
#[instruction(cpu_cores: u8, ram_gb: u16, storage_gb: u32, price_per_job: u64)]
pub struct RegisterNode<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        init,
        payer = provider,
        space = NodeAccount::SPACE,
        seeds = [b"node", provider.key().as_ref()],
        bump,
    )]
    pub node_account: Account<'info, NodeAccount>,

    #[account(
        mut,
        seeds = [b"network"],
        bump = network_state.bump,
    )]
    pub network_state: Account<'info, NetworkState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterNode>,
    cpu_cores: u8,
    ram_gb: u16,
    storage_gb: u32,
    price_per_job: u64,
) -> Result<()> {
    require!(
        cpu_cores > 0 && price_per_job > 0,
        CoreNetError::InvalidNodeSpec
    );

    let node = &mut ctx.accounts.node_account;
    node.owner = ctx.accounts.provider.key();
    node.cpu_cores = cpu_cores;
    node.ram_gb = ram_gb;
    node.storage_gb = storage_gb;
    node.price_per_job = price_per_job;
    node.jobs_completed = 0;
    node.active_jobs = 0;
    node.reputation = 50;
    node.is_active = true;
    node.bump = ctx.bumps.node_account;

    ctx.accounts.network_state.total_nodes += 1;

    Ok(())
}
