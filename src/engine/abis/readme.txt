✅ orchestrator
- pooltoken
- 


Steps
- Set env `RECIPIENT` address from new EOA address
- Set `PRIVATE_KEY_EXECUTOR` and `PRIVATE_KEY_SPONSOR` from compromised wallet
- Generate a `FLASHBOTS_RELAY_SIGNING_KEY` for submitting transaction, and populate env variable
- Uncomment Goerli code, and set `ETHEREUM_RPC_URL` from alchemy url for mainnet
- TODO `collectRewards()` on MembershipOrchestrator
- TODO `?` Withdraw PoolToken and GFI
- `cancelWithdrawalRequest(tokenId 662)` on SeniorPool
- ERC721 `Transfer(652)` on PoolToken to RECIPIENT

ERC20s
usdc, fidu, mpl, eth, gfi

Tokens
Withdraw request 662
Pool token 652
NEED capital position and gfi position ID