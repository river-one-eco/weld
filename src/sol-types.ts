/**
 * Re-export AST node types from @solidity-parser/parser via a relative path
 * so they can be used without relying on the package's (unexported) internals.
 */

// BaseASTNode shape we rely on
export interface LocNode {
  loc?: {
    start?: { line?: number; column?: number };
    end?: { line?: number; column?: number };
  };
}

export interface ContractDef extends LocNode {
  type: 'ContractDefinition';
  name: string;
  kind: 'contract' | 'interface' | 'library' | 'abstract';
  subNodes: SolNode[];
}

export interface FunctionDef extends LocNode {
  type: 'FunctionDefinition';
  name: string | null;
  visibility: 'external' | 'public' | 'internal' | 'private' | 'default';
  stateMutability: 'pure' | 'view' | 'payable' | null;
  modifiers: ModifierInvoke[];
  isConstructor: boolean;
  isFallback: boolean;
  isReceiveEther: boolean;
  isVirtual: boolean;
  override: unknown | null;
  returnParameters: VariableDecl[] | null;
  parameters: VariableDecl[];
  body: unknown | null;
}

export interface ModifierInvoke extends LocNode {
  type: 'ModifierInvocation';
  name: Identifier | string;
  arguments: SolNode[] | null;
}

export interface Identifier extends LocNode {
  type: 'Identifier';
  name: string;
}

export interface VariableDecl extends LocNode {
  type: 'VariableDeclaration';
  name: string | null;
  typeName: TypeName | null;
  storageLocation: 'memory' | 'storage' | 'calldata' | null;
  visibility: string;
  isIndexed: boolean;
  isDeclaredConst: boolean;
  isImmutable: boolean;
}

export interface StateVariableDecl extends LocNode {
  type: 'StateVariableDeclaration';
  variables: StateVariableDeclarationVariable[];
  initialValue: SolNode | null;
}

export interface StateVariableDeclarationVariable extends VariableDecl {
  isDeclaredConst: boolean;
  isImmutable: boolean;
}

export interface EventDef extends LocNode {
  type: 'EventDefinition';
  name: string;
  parameters: VariableDecl[];
}

export interface CustomErrorDef extends LocNode {
  type: 'CustomErrorDefinition';
  name: string;
  parameters: VariableDecl[];
}

export interface TypeName extends LocNode {
  type: string;
  name?: string;
  namePath?: string;
  baseTypeName?: TypeName;
}

// Catch-all
export type SolNode =
  | ContractDef
  | FunctionDef
  | StateVariableDecl
  | EventDef
  | CustomErrorDef
  | VariableDecl
  | LocNode
  | { type: string; [key: string]: unknown };
