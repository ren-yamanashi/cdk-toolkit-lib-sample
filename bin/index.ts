#!/usr/bin/env node
import { RequireApproval } from 'aws-cdk-lib/cloud-assembly-schema';
import { Command } from 'commander';
import { z } from 'zod';
import { CdkCli, COMMAND_NAME, CommandConfig, CommandName } from './cdk-cli';

const commandConfigSchema = z
  .object({
    commandName: z.enum(COMMAND_NAME),
    profile: z.string().optional(),
    requireApproval: z.enum(RequireApproval).default(RequireApproval.BROADENING),
    all: z.boolean().default(false),
    context: z.array(z.string()).default([]),
    stackNames: z.array(z.string()).default([]),
    cdkJsonPath: z.string().optional(),
  })
  .refine(data => !data.all || !data.stackNames.length, {
    message: '--all オプションが指定されている場合は、Stack 名を指定することはできません',
  }) satisfies z.ZodType<CommandConfig>;

const main = (command: Command, commandName: CommandName): void => {
  command
    .command(commandName)
    .argument('[stackNames...]')
    .option('-p, --profile <profile>', 'AWS CDK のプロファイル名')
    .option(
      '--require-approval <requireApproval>',
      'CDK の require-approval オプションを指定する [BROADENING | NEVER | ANY_CHANGE]'
    )
    .option(
      '-c, --context <context>',
      'CDK の Context を指定する（KEY=VALUE形式）',
      (val: string, prev: string[]) => [...prev, val],
      []
    )
    .option('--all', '全ての Stack を対象にする')
    .action(async (args, options) => {
      const config = commandConfigSchema.safeParse({
        ...options,
        ...args,
        commandName,
      });
      if (!config.success) {
        console.error(`オプションの形式が正しくありません。以下の形式でオプションを指定してください
        ${program.name()} ${commandName} [--profile <profile>] [--require-approval <requireApproval>] [--context <KEY=VALUE>...] [--all] [stackNames...]`);
        process.exit(1);
      }
      const cdkCli = new CdkCli(config.data);
      await cdkCli.execute(config.data);
    });
};

const program = new Command();

main(program, COMMAND_NAME.DEPLOY);
main(program, COMMAND_NAME.SYNTH);
main(program, COMMAND_NAME.HOTSWAP);
main(program, COMMAND_NAME.WATCH);
main(program, COMMAND_NAME.DIFF);

program.parse(process.argv);
