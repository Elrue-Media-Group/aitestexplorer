#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CostEstimator } from './cost-estimator.js';
import chalk from 'chalk';

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('pages', {
      type: 'number',
      description: 'Number of pages to analyze',
      default: 10,
    })
    .option('actions', {
      type: 'number',
      description: 'Maximum number of actions',
      default: 50,
    })
    .option('quick', {
      type: 'boolean',
      description: 'Show quick estimates for common scenarios',
      default: false,
    })
    .help()
    .parse();

  const estimator = new CostEstimator();

  if (argv.quick) {
    console.log(chalk.blue.bold('\n💰 Quick Cost Estimates\n'));
    console.log(chalk.gray('Common usage scenarios:\n'));
    
    const quickEstimates = estimator.getQuickEstimates();
    for (const estimate of quickEstimates) {
      const cost = estimator.estimateCost(estimate.pages, estimate.actions);
      console.log(
        chalk.cyan(`  ${estimate.pages} pages, ${estimate.actions} actions:`),
        chalk.yellow(`$${cost.totalCost.toFixed(4)}`)
      );
    }
    console.log('');
  } else {
    const pages = argv.pages as number;
    const actions = argv.actions as number;
    
    const estimate = estimator.estimateCost(pages, actions);
    console.log(chalk.blue.bold('\n💰 Cost Calculator\n'));
    console.log(chalk.yellow(estimator.formatEstimate(estimate)));
  }
}

main().catch((error) => {
  console.error(chalk.red('Error:'), error);
  process.exit(1);
});

