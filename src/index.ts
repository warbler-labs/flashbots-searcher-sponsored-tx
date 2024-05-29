import {
  FlashbotsBundleProvider,
  FlashbotsBundleRawTransaction,
  FlashbotsBundleResolution,
  FlashbotsBundleTransaction,
} from "@flashbots/ethers-provider-bundle";
import { BigNumber, providers, Wallet, Contract } from "ethers";
import { checkSimulation, gasPriceToGwei, printTransactions } from "./utils";
import {
  MEMBERSHIP_ORCHESTRATOR_ABI,
  MEMBERSHIP_ORCHESTRATOR_ADDRESS,
} from "./engine/abis/MembershipOrchestrator";
import { POOL_TOKEN_ABI, POOL_TOKEN_ADDRESS } from "./engine/abis/PoolToken";
import {
  ERC20_ABI,
  FIDU_ADDRESS,
  GFI_ADDRESS,
  MPL_ADDRESS,
  USDC_ADDRESS,
} from "./engine/abis/ERC20";
import { SENIOR_POOL_ABI, SENIOR_POOL_ADDRESS } from "./engine/abis/SeniorPool";

require("log-timestamp");

const BLOCKS_IN_FUTURE = 2;

const GWEI = BigNumber.from(10).pow(9);
const PRIORITY_GAS_PRICE = GWEI.mul(31);

const PRIVATE_KEY_EXECUTOR = process.env.PRIVATE_KEY_EXECUTOR as string;
const PRIVATE_KEY_SPONSOR = process.env.PRIVATE_KEY_SPONSOR as string;
const FLASHBOTS_RELAY_SIGNING_KEY = process.env
  .FLASHBOTS_RELAY_SIGNING_KEY as string;
const RECIPIENT = process.env.RECIPIENT as string;
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL as string;

if (!PRIVATE_KEY_EXECUTOR) {
  console.warn(
    "Must provide PRIVATE_KEY_EXECUTOR environment variable, corresponding to Ethereum EOA with assets to be transferred"
  );
  process.exit(1);
}
if (!PRIVATE_KEY_SPONSOR) {
  console.warn(
    "Must provide PRIVATE_KEY_SPONSOR environment variable, corresponding to an Ethereum EOA with ETH to pay miner"
  );
  process.exit(1);
}
if (!FLASHBOTS_RELAY_SIGNING_KEY) {
  console.warn(
    "Must provide FLASHBOTS_RELAY_SIGNING_KEY environment variable. Please see https://github.com/flashbots/pm/blob/main/guides/flashbots-alpha.md"
  );
  process.exit(1);
}
if (!RECIPIENT) {
  console.warn(
    "Must provide RECIPIENT environment variable, an address which will receive assets"
  );
  process.exit(1);
}
if (!ETHEREUM_RPC_URL) {
  console.warn(
    "Must provide ETHEREUM_RPC_URL environment variable for MAINNET"
  );
  process.exit(1);
}

async function main() {
  const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);

  const walletExecutor = new Wallet(PRIVATE_KEY_EXECUTOR);
  const walletSponsor = new Wallet(PRIVATE_KEY_SPONSOR);

  const block = await provider.getBlock("latest");

  const membershipOrchestrator = new Contract(
    MEMBERSHIP_ORCHESTRATOR_ADDRESS,
    MEMBERSHIP_ORCHESTRATOR_ABI
  );
  const poolTokens = new Contract(POOL_TOKEN_ADDRESS, POOL_TOKEN_ABI);
  const gfi = new Contract(GFI_ADDRESS, ERC20_ABI);
  const mpl = new Contract(MPL_ADDRESS, ERC20_ABI);
  const fidu = new Contract(FIDU_ADDRESS, ERC20_ABI);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI);
  const seniorPool = new Contract(SENIOR_POOL_ADDRESS, SENIOR_POOL_ABI);

  const membershipFiduRewards: BigNumber =
    await membershipOrchestrator.claimableRewards(walletExecutor.address);
  const membership_withdrawAssets = [
    {
      ...(await membershipOrchestrator.populateTransaction.collectRewards()),
      gasPrice: BigNumber.from(0),
    },
    {
      ...(await membershipOrchestrator.populateTransaction.withdraw(
        // GFI LEDGER: https://etherscan.io/address/0xbc1081885da00404bd0108b70ec5ac0dbe98a077#readProxyContract
        // balance: 1, GFI: 105263008015613970198301
        [426],
        // CAPITAL LEDGER: https://etherscan.io/address/0x94e0bc3aeda93434b848c49752cfc58b1e7c5029#readProxyContract
        // balance: 1, pool token id: 652,
        [557]
      )),
      gasPrice: BigNumber.from(0),
    },
  ];

  // withdraw request - carter
  // withdraw token id 662
  const [, usdcWithdrawable, fiduRequested]: [unknown, BigNumber, BigNumber] =
    await seniorPool.withdrawalRequest(662);

  const seniorPool_manageWithdrawRequests = [
    // confirmed as of 5/28 there's nothing to claim. only add if this has changed
    {
      ...(await seniorPool.populateTransaction.claimWithdrawalRequest(662)),
      gasPrice: BigNumber.from(0),
    },
    {
      ...(await seniorPool.populateTransaction.cancelWithdrawalRequest(662)),
      gasPrice: BigNumber.from(0),
    },
  ];

  const fiduBalance: BigNumber = await fidu.balanceOf(walletExecutor.address);
  const fidu_transfersToRecipient = [
    {
      ...(await fidu.populateTransaction.transfer(
        RECIPIENT,
        fiduBalance.add(fiduRequested).add(membershipFiduRewards)
      )),
      gasPrice: BigNumber.from(0),
    },
  ];

  const usdcBalance: BigNumber = await usdc.balanceOf(walletExecutor.address);
  const usdc_transfersToRecipient = [
    {
      ...(await usdc.populateTransaction.transfer(
        RECIPIENT,
        usdcBalance.add(usdcWithdrawable)
      )),
      gasPrice: BigNumber.from(0),
    },
  ];

  const poolToken_transfersToRecipient = [
    {
      // transfer the pool token taken out of membership
      ...(await poolTokens.populateTransaction.safeTransferFrom(
        walletExecutor.address,
        RECIPIENT,
        652
      )),
      gasPrice: BigNumber.from(0),
    },
  ];

  const gfi_transfersToRecipient = [
    {
      // transfer the gfi taken out of membership
      // they currently ahve 105263008015613970198301 GFI in membership
      ...(await gfi.populateTransaction.transfer(
        RECIPIENT,
        "105263008015613970198301"
      )),
      gasPrice: BigNumber.from(0),
    },
  ];

  const mplBalance = await mpl.balanceOf(walletExecutor.address);
  const mpl_transfersToRecipient = [
    {
      ...(await mpl.populateTransaction.transfer(RECIPIENT, mplBalance)),
      gasPrice: BigNumber.from(0),
    },
  ];

  // TODO: transfer eth?

  // Order of Operations:
  // 1. Withdraw assets from Membership & claim rewards (receive GFI & PT)
  // 2a. Claim SeniorPool WithdrawalRequest (receive USDC)
  // 2b. Cancel SeniorPool WithdrawalRequest (receive FIDU)
  // 3. Transfer PoolToken to Recipient
  // 4. Transfer USDC to Recipient
  // 5. Transfer FIDU to Recipient
  // 6. Transfer GFI to Recipient
  // 7. Transfer MPL to Recipient
  const sponsoredTransactions = [
    ...membership_withdrawAssets,
    ...seniorPool_manageWithdrawRequests,
    ...poolToken_transfersToRecipient,
    ...usdc_transfersToRecipient,
    ...fidu_transfersToRecipient,
    ...gfi_transfersToRecipient,
    ...mpl_transfersToRecipient,
  ];

  const gasEstimates = await Promise.all(
    sponsoredTransactions.map((tx) =>
      provider.estimateGas({
        ...tx,
        from: tx.from === undefined ? walletExecutor.address : tx.from,
      })
    )
  );
  const gasEstimateTotal = gasEstimates.reduce(
    (acc, cur) => acc.add(cur),
    BigNumber.from(0)
  );

  const gasPrice = PRIORITY_GAS_PRICE.add(block.baseFeePerGas || 0);
  const bundleTransactions: Array<
    FlashbotsBundleTransaction | FlashbotsBundleRawTransaction
  > = [
    {
      transaction: {
        to: walletExecutor.address,
        gasPrice: gasPrice,
        value: gasEstimateTotal.mul(gasPrice),
        gasLimit: 21000,
      },
      signer: walletSponsor,
    },
    ...sponsoredTransactions.map((transaction, txNumber) => {
      return {
        transaction: {
          ...transaction,
          gasPrice: gasPrice,
          gasLimit: gasEstimates[txNumber],
        },
        signer: walletExecutor,
      };
    }),
  ];

  const walletRelay = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    walletRelay
  );
  const signedBundle = await flashbotsProvider.signBundle(bundleTransactions);
  await printTransactions(bundleTransactions, signedBundle);
  const simulatedGasPrice = await checkSimulation(
    flashbotsProvider,
    signedBundle
  );

  // console.log(await engine.description())

  console.log(`Executor Account: ${walletExecutor.address}`);
  console.log(`Sponsor Account: ${walletSponsor.address}`);
  console.log(`Simulated Gas Price: ${gasPriceToGwei(simulatedGasPrice)} gwei`);
  console.log(`Gas Price: ${gasPriceToGwei(gasPrice)} gwei`);
  console.log(`Gas Used: ${gasEstimateTotal.toString()}`);

  provider.on("block", async (blockNumber) => {
    const simulatedGasPrice = await checkSimulation(
      flashbotsProvider,
      signedBundle
    );
    const targetBlockNumber = blockNumber + BLOCKS_IN_FUTURE;
    console.log(
      `Current Block Number: ${blockNumber},   Target Block Number:${targetBlockNumber},   gasPrice: ${gasPriceToGwei(
        simulatedGasPrice
      )} gwei`
    );
    const bundleResponse = await flashbotsProvider.sendBundle(
      bundleTransactions,
      targetBlockNumber
    );
    if ("error" in bundleResponse) {
      throw new Error(bundleResponse.error.message);
    }
    const bundleResolution = await bundleResponse.wait();
    if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
      console.log(`Congrats, included in ${targetBlockNumber}`);
      process.exit(0);
    } else if (
      bundleResolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion
    ) {
      console.log(`Not included in ${targetBlockNumber}`);
    } else if (
      bundleResolution === FlashbotsBundleResolution.AccountNonceTooHigh
    ) {
      console.log("Nonce too high, bailing");
      process.exit(1);
    }
  });
}

main();
