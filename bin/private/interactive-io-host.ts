import * as readline from 'node:readline/promises';
import * as util from 'node:util';

import {
  IIoHost,
  IoRequest,
  NonInteractiveIoHost,
  NonInteractiveIoHostProps,
  PermissionChangeType,
} from '@aws-cdk/toolkit-lib';
import { RequireApproval } from 'aws-cdk-lib/cloud-assembly-schema';

type IoRequestMessage = IoRequest<
  | {
      permissionChangeType: PermissionChangeType;
      motivation?: string;
      concurrency?: number;
      responseDescription?: string;
    }
  | undefined,
  unknown
>;

interface InteractiveIoHostProps extends NonInteractiveIoHostProps {
  /**
   * 承認が必要な変更のレベル
   * @default RequireApproval.BROADENING
   */
  readonly requireApproval?: RequireApproval;
}

export class InteractiveIoHost extends NonInteractiveIoHost implements IIoHost {
  private readonly requireDeployApproval: RequireApproval;

  constructor(props?: InteractiveIoHostProps) {
    super(props);
    this.requireDeployApproval =
      props?.requireApproval ?? RequireApproval.BROADENING;
  }

  // NOTE: aws-cdk-cli の `CliIoHost` の `requestResponse` メソッドを参考に実装している
  // https://github.com/aws/aws-cdk-cli/blob/@aws-cdk/toolkit-lib@v1.2.4/packages/aws-cdk/lib/cli/io-host/cli-io-host.ts
  override async requestResponse<DataType, ResponseType>(
    msg: IoRequest<DataType, ResponseType>
  ): Promise<ResponseType> {
    const message = msg as IoRequestMessage;
    if (this.skipApprovalStep(message)) return true as ResponseType;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      // NOTE: defaultResponse が boolean でない場合は、プロンプト情報を抽出して表示し、ユーザーの入力を待つ。その後、ユーザーが回答した内容を変換して返す
      if (typeof msg.defaultResponse !== 'boolean') {
        const prompt = this.extractPromptInfo(message);
        const desc = message.data?.responseDescription ?? prompt.default;
        const answer = await rl.question(
          `${message.message}${desc ? ` (${desc})` : ''}: `
        );
        const finalAnswer = answer.trim() || prompt.default;
        return prompt.convertAnswer(finalAnswer) as ResponseType;
      }
      // NOTE: defaultResponse が boolean の場合は、承認を求めるメッセージを表示し、ユーザーの入力を待つ
      const answer = await rl.question(`${msg.message} (y/n): `);
      const confirmed =
        answer.toLowerCase().trim() === 'y' ||
        answer.toLowerCase().trim() === 'yes';
      if (!confirmed) throw new Error('Aborted by user');
      return confirmed as ResponseType;
    } finally {
      rl.close();
    }
  }

  /**
   * 指定されたメッセージが承認をスキップできるかどうかを判定する
   * @returns 承認をスキップできる場合は true
   */
  private skipApprovalStep(msg: IoRequestMessage): boolean {
    // NOTE: `CDK_TOOLKIT_I5060` は、セキュリティ機密の変更を確認するコード
    // https://github.com/aws/aws-cdk-cli/blob/@aws-cdk/toolkit-lib@v1.2.4/packages/@aws-cdk/toolkit-lib/docs/message-registry.md
    const approvalToolkitCodes = ['CDK_TOOLKIT_I5060'];
    if (!approvalToolkitCodes.includes(msg.code)) return false;
    switch (this.requireDeployApproval) {
      case RequireApproval.NEVER:
        return true;
      case RequireApproval.ANYCHANGE:
        return false;
      case RequireApproval.BROADENING:
        return ['none', 'non-broadening'].includes(
          msg.data?.permissionChangeType ?? ''
        );
    }
  }

  /**
   * リクエストからプロンプト情報を抽出する
   * @returns プロンプト情報を含むオブジェクト
   */
  private extractPromptInfo(request: IoRequest<unknown, unknown>): {
    default: string;
    defaultDesc: string;
    convertAnswer: (input: string) => string | number;
  } {
    const defaultResponse = util.format(request.defaultResponse);
    return {
      default: defaultResponse,
      defaultDesc:
        'defaultDescription' in request && request.defaultDescription
          ? util.format(request.defaultDescription)
          : defaultResponse,
      convertAnswer:
        typeof request.defaultResponse === 'number'
          ? v => Number(v)
          : v => String(v),
    };
  }
}
