import { defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

const DEFAULT_TASK = "01-token";
const TASK = process.env.TASK ?? DEFAULT_TASK;

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: `./${TASK}/contracts`,
    tests: {
      nodejs: `./${TASK}/tests`,
    },
    cache: `./${TASK}/.cache`,
    artifacts: `./${TASK}/.artifacts`,
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
  },
});
