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
    #[msg("Payment must be greater than zero")]
    ZeroPayment,
    #[msg("Node spec must have at least 1 CPU core and a non-zero price")]
    InvalidNodeSpec,
    #[msg("Job spec exceeds 200-character limit")]
    SpecTooLong,
    #[msg("Job result exceeds 200-character limit")]
    ResultTooLong,
}
