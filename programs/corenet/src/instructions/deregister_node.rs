use anchor_lang::prelude::*;
use crate::errors::CoreNetError;
use crate::state::{NetworkState, NodeAccount};

#[derive(Accounts)]
pub struct DeregisterNode<'info> {
    /// Receives the rent lamports when node_account is closed.
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        close = provider,
        seeds = [b"node", provider.key().as_ref()],
        bump = node_account.bump,
        constraint = node_account.owner == provider.key() @ CoreNetError::Unauthorized,
        constraint = node_account.is_active @ CoreNetError::NodeNotActive,
        constraint = node_account.active_jobs == 0 @ CoreNetError::ActiveJobsExist,
    )]
    pub node_account: Account<'info, NodeAccount>,

    #[account(
        mut,
        seeds = [b"network"],
        bump = network_state.bump,
    )]
    pub network_state: Account<'info, NetworkState>,
}

pub fn handler(ctx: Context<DeregisterNode>) -> Result<()> {
    ctx.accounts.network_state.total_nodes =
        ctx.accounts.network_state.total_nodes.saturating_sub(1);
    Ok(())
}
