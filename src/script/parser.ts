/**
 * S2 脚本语法分析。语句以 `;` 结束（`}` 与文件尾前可省略）；
 * 表达式按 * / 高于 + - 高于比较高于逻辑的优先级解析。
 */
import type { Expr, OnBlock, Script, Stmt, AssignOp } from './ast';
import { tokenize, ScriptSyntaxError, type Token } from './lexer';

export { ScriptSyntaxError };

const KEYWORDS = new Set(['on', 'if', 'elseif', 'else', 'loop', 'exit', 'skip', 'skipevent']);
const LOGIC_OPS = new Set(['&&', '||', 'and', 'or', 'xor']);
/** 原版数据里偶有单个 `=` 作比较使用，与 `==` 同义。 */
const CMP_OPS = new Set(['==', '=', '!=', '<', '>', '<=', '>=', '=>', '=<']);

class Parser {
  private pos = 0;

  constructor(private readonly toks: Token[]) {}

  private peek(offset = 0): Token {
    return this.toks[Math.min(this.pos + offset, this.toks.length - 1)];
  }

  private next(): Token {
    return this.toks[this.pos++];
  }

  private isPunct(v: string, t: Token = this.peek()): boolean {
    return t.type === 'punct' && t.value === v;
  }

  private isOp(v: string, t: Token = this.peek()): boolean {
    return t.type === 'op' && t.value === v;
  }

  private isIdent(v: string, t: Token = this.peek()): boolean {
    return t.type === 'ident' && t.value === v;
  }

  private expectPunct(v: string): void {
    const t = this.next();
    if (!this.isPunct(v, t)) throw new ScriptSyntaxError(`expected '${v}'`, t.line);
  }

  private endStatement(): void {
    const t = this.peek();
    if (this.isPunct(';', t)) { this.next(); return; }
    if (this.isPunct('}', t) || t.type === 'eof') return;
    throw new ScriptSyntaxError(`expected ';'`, t.line);
  }

  parseScript(): Script {
    const top: Stmt[] = [];
    const events: OnBlock[] = [];
    while (this.peek().type !== 'eof') {
      if (this.isIdent('on') && this.isOp(':', this.peek(1))) {
        events.push(this.parseOn());
      } else {
        top.push(this.parseStmt());
      }
    }
    return { top, events };
  }

  private parseOn(): OnBlock {
    const start = this.next();
    this.next();
    const name = this.next();
    if (name.type !== 'ident') throw new ScriptSyntaxError('expected event name after on:', name.line);
    let event = name.value;
    while (this.peek().type === 'num' || this.peek().type === 'ident') {
      const t = this.next();
      event += t.type === 'num' ? t.value : t.value;
    }
    const body = this.parseBlock();
    return { event, body, line: start.line };
  }

  private parseBlock(): Stmt[] {
    this.expectPunct('{');
    const body: Stmt[] = [];
    while (!this.isPunct('}')) {
      if (this.peek().type === 'eof') throw new ScriptSyntaxError(`expected '}'`, this.peek().line);
      body.push(this.parseStmt());
    }
    this.next();
    return body;
  }

  private parseStmt(): Stmt {
    let suppress = false;
    if (this.isOp('@')) {
      this.next();
      suppress = true;
    }
    const t = this.peek();
    if (t.type === 'var') return this.parseAssign();
    if (t.type === 'ident') {
      switch (t.value) {
        case 'if': return this.parseIf();
        case 'loop': return this.parseLoop();
        case 'exit': case 'skip': case 'skipevent': {
          this.next();
          this.endStatement();
          return { kind: t.value, line: t.line };
        }
        case 'on':
          throw new ScriptSyntaxError(`'on' must not be subordinated to conditions`, t.line);
        case 'elseif': case 'else':
          throw new ScriptSyntaxError(`'${t.value}' without if`, t.line);
        default:
          return this.parseCommand(suppress);
      }
    }
    if (this.isPunct(';', t)) { this.next(); return { kind: 'command', name: '', args: [], suppress, line: t.line }; }
    throw new ScriptSyntaxError(`unexpected ${describe(t)}`, t.line);
  }

  private parseAssign(): Stmt {
    const v = this.next() as Extract<Token, { type: 'var' }>;
    const opTok = this.next();
    if (opTok.type !== 'op' || !['=', '+=', '-=', '++', '--'].includes(opTok.value)) {
      throw new ScriptSyntaxError('expected variable assignment (=,+=,++,-=,--)', opTok.line);
    }
    const op = opTok.value as AssignOp;
    let expr: Expr | undefined;
    if (op === '=' || op === '+=' || op === '-=') expr = this.parseExpr();
    this.endStatement();
    return { kind: 'assign', name: v.name, op, expr, line: v.line };
  }

  private parseCommand(suppress: boolean): Stmt {
    const name = this.next() as Extract<Token, { type: 'ident' }>;
    const args: Expr[] = [];
    if (!this.isPunct(';') && !this.isPunct('}') && this.peek().type !== 'eof') {
      args.push(this.parseExpr());
      while (this.isPunct(',')) {
        this.next();
        args.push(this.parseExpr());
      }
    }
    this.endStatement();
    return { kind: 'command', name: name.value, args, suppress, line: name.line };
  }

  private parseIf(): Stmt {
    const start = this.next();
    const branches: { cond: Expr; body: Stmt[] }[] = [];
    this.expectPunct('(');
    let cond = this.parseExpr();
    this.expectPunct(')');
    branches.push({ cond, body: this.parseBlock() });
    let elseBody: Stmt[] | undefined;
    for (;;) {
      if (this.isIdent('elseif')) {
        this.next();
        this.expectPunct('(');
        cond = this.parseExpr();
        this.expectPunct(')');
        branches.push({ cond, body: this.parseBlock() });
      } else if (this.isIdent('else')) {
        this.next();
        if (this.isIdent('if')) {
          this.next();
          this.expectPunct('(');
          cond = this.parseExpr();
          this.expectPunct(')');
          branches.push({ cond, body: this.parseBlock() });
          continue;
        }
        elseBody = this.parseBlock();
        break;
      } else {
        break;
      }
    }
    return { kind: 'if', branches, else: elseBody, line: start.line };
  }

  private parseLoop(): Stmt {
    const start = this.next();
    this.expectPunct('(');
    const mode = this.parseExpr();
    let arg: Expr | undefined;
    if (this.isPunct(',')) {
      this.next();
      arg = this.parseExpr();
    }
    this.expectPunct(')');
    const body = this.parseBlock();
    return { kind: 'loop', mode, arg, body, line: start.line };
  }

  parseExpr(): Expr {
    return this.parseLogic();
  }

  private parseLogic(): Expr {
    let left = this.parseCmp();
    for (;;) {
      const t = this.peek();
      const op = t.type === 'op' || t.type === 'ident' ? t.value : '';
      if (!LOGIC_OPS.has(op)) return left;
      this.next();
      left = { kind: 'binary', op, left, right: this.parseCmp() };
    }
  }

  private parseCmp(): Expr {
    let left = this.parseAdd();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || !CMP_OPS.has(t.value)) return left;
      this.next();
      left = { kind: 'binary', op: t.value === '=' ? '==' : t.value, left, right: this.parseAdd() };
    }
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || (t.value !== '+' && t.value !== '-')) return left;
      this.next();
      left = { kind: 'binary', op: t.value, left, right: this.parseMul() };
    }
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || (t.value !== '*' && t.value !== '/')) return left;
      this.next();
      left = { kind: 'binary', op: t.value, left, right: this.parseUnary() };
    }
  }

  private parseUnary(): Expr {
    if (this.isOp('-')) {
      this.next();
      return { kind: 'unary', op: '-', expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.type) {
      case 'num': return { kind: 'num', value: t.value };
      case 'str': return { kind: 'str', parts: t.parts };
      case 'var': return { kind: 'var', name: t.name };
      case 'ident': {
        if (this.isPunct('(')) {
          this.next();
          const args: Expr[] = [];
          if (!this.isPunct(')')) {
            args.push(this.parseExpr());
            while (this.isPunct(',')) {
              this.next();
              args.push(this.parseExpr());
            }
          }
          this.expectPunct(')');
          return { kind: 'call', name: t.value, args, line: t.line };
        }
        if (KEYWORDS.has(t.value)) throw new ScriptSyntaxError(`unexpected '${t.value}'`, t.line);
        return { kind: 'str', parts: [t.value] };
      }
      case 'punct':
        if (t.value === '(') {
          const e = this.parseExpr();
          this.expectPunct(')');
          return e;
        }
        break;
      default:
        break;
    }
    throw new ScriptSyntaxError(`unexpected ${describe(t)} in expression`, t.line);
  }
}

function describe(t: Token): string {
  switch (t.type) {
    case 'eof': return 'end of script';
    case 'str': return 'string';
    case 'var': return `$${t.name}`;
    default: return `'${t.value}'`;
  }
}

export function parseScript(source: string): Script {
  return new Parser(tokenize(source)).parseScript();
}

export function scriptEvents(script: Script): Set<string> {
  return new Set(script.events.map(e => e.event));
}
