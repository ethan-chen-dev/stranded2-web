/** S2 脚本语法树。 */
export type StrPart = string | { var: string };

export type Expr =
  | { kind: 'num'; value: string }
  | { kind: 'str'; parts: StrPart[] }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '-'; expr: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[]; line: number };

export type AssignOp = '=' | '+=' | '-=' | '++' | '--';

export type Stmt =
  | { kind: 'assign'; name: string; op: AssignOp; expr?: Expr; line: number }
  | { kind: 'command'; name: string; args: Expr[]; suppress: boolean; line: number }
  | { kind: 'if'; branches: { cond: Expr; body: Stmt[] }[]; else?: Stmt[]; line: number }
  | { kind: 'loop'; mode: Expr; arg?: Expr; body: Stmt[]; line: number }
  | { kind: 'exit' | 'skip' | 'skipevent'; line: number };

export interface OnBlock {
  event: string;
  body: Stmt[];
  line: number;
}

export interface Script {
  top: Stmt[];
  events: OnBlock[];
}
