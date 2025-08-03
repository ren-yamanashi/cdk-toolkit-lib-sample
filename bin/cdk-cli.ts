import {
  BaseCredentials,
  CdkAppMultiContext,
  ICloudAssemblySource,
  StackSelectionStrategy,
  StackSelector,
  Toolkit,
} from '@aws-cdk/toolkit-lib';
import { RequireApproval } from 'aws-cdk-lib/cloud-assembly-schema';
import * as fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { InteractiveIoHost } from './private/interactive-io-host';

const cdkJsonSchema = z.object({
  app: z.string(),
});

export const COMMAND_NAME = {
  DEPLOY: 'deploy',
  SYNTH: 'synth',
  HOTSWAP: 'hotswap',
  WATCH: 'watch',
  DIFF: 'diff',
} as const;

export type CommandName = (typeof COMMAND_NAME)[keyof typeof COMMAND_NAME];

export type CommandConfig = {
  commandName: CommandName;
  requireApproval: RequireApproval;
  all: boolean;
  context: string[];
  stackNames: string[];
  profile?: string | undefined;
  cdkJsonPath?: string | undefined;
};

export class CdkCli {
  private readonly toolkit: Toolkit;

  constructor(config: CommandConfig) {
    const { profile, requireApproval } = config;
    this.toolkit = new Toolkit({
      sdkConfig: {
        baseCredentials: profile
          ? BaseCredentials.awsCliCompatible({ profile })
          : BaseCredentials.awsCliCompatible(),
      },
      ioHost: new InteractiveIoHost({ requireApproval }),
    });
  }

  public async execute(config: CommandConfig): Promise<void> {
    const cx = await this.getCloudAssemblySource(config);
    const stackNames = await this.getStackNames(config, cx);

    await this.toolkit.deploy(cx);

    switch (config.commandName) {
      // NOTE: 1つ目の Stack でカスタムリソースの戻り値を SSM パラメータに格納し、2つ目の Stack でそのパラメータを参照するケースなどでは、
      //       全ての Stack を一度にデプロイすると、2つ目の Stack での fromValue が参照する SSM パラメータは今回反映するものではなく前回のデプロイ時のものになってしまうため、それぞれの Stack で合成、デプロイする必要がある。
      case COMMAND_NAME.DEPLOY:
      case COMMAND_NAME.DIFF:
      case COMMAND_NAME.HOTSWAP:
      case COMMAND_NAME.WATCH: {
        for (const stackName of stackNames) {
          const stacks: StackSelector = {
            strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
            patterns: [stackName],
          };
          await this.toolkit.deploy(cx, {
            stacks,
          });
        }
        break;
      }
      // NOTE: `synth` コマンドはカスタムリソースが走らないので、すべての stack を同時に実行していい
      case COMMAND_NAME.SYNTH: {
        const cloudAssembly = await this.toolkit.synth(cx);
        await cloudAssembly.dispose(); // cdk.out の lock ファイルを解放
        break;
      }
    }
  }

  /**
   * CDK アプリケーションの CloudAssemblySource を取得する
   * @param config - コマンドの設定
   * @returns CloudAssemblySource
   */
  private async getCloudAssemblySource(config: CommandConfig): Promise<ICloudAssemblySource> {
    const { context, cdkJsonPath } = config;
    const cwd = process.cwd();
    const rootDir = cdkJsonPath ?? cwd;
    const appCommand = this.getCdkAppCommand(cdkJsonPath ?? `${cwd}/cdk.json`);

    return await this.toolkit.fromCdkApp(appCommand, {
      workingDirectory: rootDir,
      contextStore: new CdkAppMultiContext(rootDir, {
        ...this.parseContextArray(context),
      }),
      outdir: path.resolve(rootDir, './cdk.out'),
    });
  }

  /**
   * CDK コンテキストの配列をオブジェクトに変換する
   * @param contextArray - "KEY=VALUE" 形式の文字列配列
   * @returns CDK コンテキストのオブジェクト
   *
   * @example
   * contextArray: ['KEY1=VALUE1', 'KEY2=VALUE2']
   * returns: { KEY1: 'VALUE1', KEY2: 'VALUE2' }
   */
  private parseContextArray(contextArray: string[]): Record<string, string> {
    return contextArray.reduce((acc, context) => {
      const [key, ...valueParts] = context.split('=');
      return key && valueParts.length ? Object.assign(acc, { [key]: valueParts[0] }) : acc;
    }, {});
  }

  /**
   * Stack 名を取得する
   * - `all` オプションが指定されている場合、または Stack 名が指定されていない場合、全ての Stack 名を返す
   * - Stack 名が指定されている場合は、その Stack 名を返す
   */
  private async getStackNames(
    config: CommandConfig,
    cloudAssemblySource: ICloudAssemblySource
  ): Promise<string[]> {
    const { all, stackNames } = config;
    const asm = await cloudAssemblySource.produce();
    await asm.dispose(); // cdk.out の lock ファイルを解放

    const stacks = asm.cloudAssembly.stacks;
    const allStackNames = stacks.map(stack => stack.stackName);

    if (!stacks.length) throw new Error('このアプリには Stack が含まれていません');

    // NOTE: `all` オプションが指定されている場合、または Stack 名が指定されていない場合、全ての Stack 名を返す
    if (all || !stackNames.length) return allStackNames;

    // NOTE: Stack 名が指定されている場合は、その Stack 名を返す
    return stackNames;
  }

  /**
   * cdk.json をパースして "app" プロパティに指定されたコマンドを取得
   * @param cdkJsonPath - cdk.json のパス
   * @returns cdk.json の "app" プロパティに指定されたコマンド、見つからない場合は null
   */
  private getCdkAppCommand = (cdkJsonPath: string): string => {
    const cdkJsonContent = fs.readFileSync(cdkJsonPath, 'utf8');
    const cdkConfig = JSON.parse(cdkJsonContent) as unknown;
    const parsedConfig = cdkJsonSchema.safeParse(cdkConfig);
    if (!parsedConfig.success) {
      throw new Error(
        'cdk.json のフォーマットが不正です。"app" プロパティに値を指定してください。'
      );
    }
    return parsedConfig.data.app;
  };
}
