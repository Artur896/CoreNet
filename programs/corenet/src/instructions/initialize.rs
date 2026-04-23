use anchor_lang::prelude::*;
use crate::state::NetworkState;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = NetworkState::SPACE,
        seeds = [b"network"],
        bump,
    )]
    pub network_state: Account<'info, NetworkState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let network = &mut ctx.accounts.network_state;
    network.admin = ctx.accounts.admin.key();
    network.total_nodes = 0;
    network.total_jobs = 0;
    network.bump = ctx.bumps.network_state;
    Ok(())
}
