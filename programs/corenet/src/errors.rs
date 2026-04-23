use anchor_lang::prelude::*;

#[error_code]
pub enum CoreNetError {
    #[msg("Node does not have enough CPU or RAM to accept this job")]
    InsufficientResources,
    #[msg("Job status is invalid for this operation")]
    InvalidJobStatus,
    #[msg("Signer is not authorized to perform this action")]
    Unauthorized,
    #[msg("Node is not active")]
    NodeNotActive,
    #[msg("Node still has active jobs; deregister aborted")]
    ActiveJobsExist,
}
