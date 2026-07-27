/*
  Publisher script: reads a summary JSON and calls the deployed contract's updateBatch
  Requires environment variables: RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS
  Usage: NODE_OPTIONS=--loader ts-node/esm node scripts/publish.js
*/

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  const rpc = process.env.RPC_URL;
  const key = process.env.PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!rpc || !key || !contractAddress) {
    console.error("Set RPC_URL, PRIVATE_KEY and CONTRACT_ADDRESS in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(key, provider);

  const contractAbi = [
    "function updateBatch(bytes32[] calldata corridorsKeys, uint256[] calldata volumes, uint256[] calldata savings) external",
  ];

  const contract = new ethers.Contract(contractAddress, contractAbi, wallet);

  const summaryPath = path.resolve(__dirname, "..", "data", "summary.json");
  if (!fs.existsSync(summaryPath)) {
    console.error(`summary.json not found at ${summaryPath}`);
    process.exit(1);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const corridors = Object.keys(summary.corridors || {});
  if (corridors.length === 0) {
    console.error("No corridors to publish");
    process.exit(1);
  }

  const keys = corridors.map(c => ethers.keccak256(ethers.toUtf8Bytes(c)));
  const volumes = corridors.map(c => BigInt(summary.corridors[c].volume));
  const savings = corridors.map(c => BigInt(summary.corridors[c].savings));

  console.log("Publishing", corridors.length, "corridors");

  const tx = await contract.updateBatch(keys, volumes, savings);
  console.log("Submitted tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Tx mined in block", receipt.blockNumber);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
