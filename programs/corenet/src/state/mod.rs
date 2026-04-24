use anchor_lang::prelude::*;

#[account]
pub struct NetworkState {
    pub admin: Pubkey,
    pub total_nodes: u32,
    pub total_jobs: u64,
    pub bump: u8,
}

impl NetworkState {
    // 8 discriminator + 32 admin + 4 total_nodes + 8 total_jobs + 1 bump
    pub const SPACE: usize = 8 + 32 + 4 + 8 + 1;
}

#[account]
pub struct NodeAccount {
    pub owner: Pubkey,
    pub cpu_cores: u8,
    pub ram_gb: u16,
    pub storage_gb: u32,
    pub price_per_job: u64,
    pub jobs_completed: u64,
    // tracks in-flight (Accepted) jobs — needed to enforce deregister guard
    pub active_jobs: u8,
    pub reputation: u8,
    pub is_active: bool,
    pub bump: u8,
}

impl NodeAccount {
    // 8 + 32 + 1 + 2 + 4 + 8 + 8 + 1 + 1 + 1 + 1
    pub const SPACE: usize = 8 + 32 + 1 + 2 + 4 + 8 + 8 + 1 + 1 + 1 + 1;
}

#[account]
pub struct JobAccount {
    pub client: Pubkey,
    pub provider: Pubkey,
    pub job_id: u64,
    pub required_cpu: u8,
    pub required_ram: u16,
    pub payment: u64,
    pub status: JobStatus,
    pub spec: String,   // JSON job spec: {"image":"...","cmd":"..."}
    pub result: String, // stdout captured by the provider daemon
    pub bump: u8,
}

impl JobAccount {
    pub const MAX_SPEC: usize = 200;
    pub const MAX_RESULT: usize = 200;
    // 8 disc + 32 client + 32 provider + 8 job_id + 1 cpu + 2 ram + 8 payment
    // + 1 status + (4+200) spec + (4+200) result + 1 bump
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 2 + 8 + 1 + (4 + 200) + (4 + 200) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum JobStatus {
    Pending,
    Accepted,
    Completed,
    Cancelled,
}
