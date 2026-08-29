/**
 * TransactionManager — operaciones multi-paso atómicas (028-transacciones).
 */

import type { CommandPayload, CommandResult, TransactionResult } from '../types/command';
import type { CommandExecutor } from './ejecutor-comandos';
import { computeSemanticDiff, type SemanticStateDiff } from './diff-estado';
import type { DAWState } from '../types/state';

export type TransactionStatus = 'pending' | 'committed' | 'rolled_back' | 'failed';

export type Transaction = {
  id: string;
  description: string;
  commands: CommandPayload[];
  createdAt: number;
  status: TransactionStatus;
};

export type TransactionCommitOptions = {
  dryRun?: boolean;
  source?: 'user' | 'ai' | 'macro' | 'script';
  userId?: string;
};

export type TransactionCommitResult = TransactionResult & {
  transactionId: string;
  status: TransactionStatus;
  stateDiff?: SemanticStateDiff;
};

export class TransactionManager {
  private pending = new Map<string, Transaction>();

  constructor(private readonly executor: CommandExecutor) {}

  begin(description: string): Transaction {
    const tx: Transaction = {
      id: crypto.randomUUID(),
      description,
      commands: [],
      createdAt: Date.now(),
      status: 'pending',
    };
    this.pending.set(tx.id, tx);
    return tx;
  }

  addCommand(tx: Transaction, cmd: CommandPayload): void {
    if (tx.status !== 'pending') throw new Error('Transacción no pendiente');
    tx.commands.push(cmd);
  }

  async commit(tx: Transaction, opts?: TransactionCommitOptions): Promise<TransactionCommitResult> {
    if (tx.status !== 'pending') {
      return {
        success: false,
        results: [],
        rolledBack: false,
        transactionId: tx.id,
        status: 'failed',
        error: { code: 'TX_NOT_PENDING', message: 'Transacción ya cerrada' },
      };
    }

    const source = opts?.source ?? 'ai';
    const before = structuredClone(this.executor.obtenerEstado()) as DAWState;

    if (opts?.dryRun) {
      const sim = await this.executor.simulateBatch(tx.commands, source, opts?.userId);
      tx.status = sim.success ? 'pending' : 'failed';
      if (!sim.success) this.pending.delete(tx.id);
      return {
        success: sim.success,
        results: sim.results,
        rolledBack: false,
        transactionId: tx.id,
        status: tx.status,
        stateDiff: sim.stateDiff,
        error: sim.success ? undefined : sim.results.find((r) => !r.success)?.error,
      };
    }

    const batch = await this.executor.batch(tx.commands, source, opts?.userId);
    const after = this.executor.obtenerEstado();
    tx.status = batch.success ? 'committed' : 'rolled_back';
    this.pending.delete(tx.id);
    return {
      ...batch,
      transactionId: tx.id,
      status: tx.status,
      stateDiff: batch.success ? computeSemanticDiff(before, after) : undefined,
    };
  }

  rollback(tx: Transaction): TransactionCommitResult {
    tx.status = 'rolled_back';
    this.pending.delete(tx.id);
    return {
      success: true,
      results: [],
      rolledBack: true,
      transactionId: tx.id,
      status: 'rolled_back',
    };
  }
}

export function crearTransactionManager(executor: CommandExecutor): TransactionManager {
  return new TransactionManager(executor);
}
