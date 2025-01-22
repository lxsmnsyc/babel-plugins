import type { NodePath, PluginObj, Visitor } from '@babel/core';
import type { Binding } from '@babel/traverse';
import * as t from '@babel/types';
import { generateUniqueName } from '../shared/generate-unique-name';
import getForeignBindings from '../shared/get-foreign-bindings';
import { isStatementTopLevel } from '../shared/is-statement-top-level';

const FUNCTION_BUBBLE: Visitor = {
  FunctionDeclaration(path) {
    if (isStatementTopLevel(path)) {
      return;
    }
    const decl = path.node;
    if (!decl.id) {
      return;
    }
    // Move this to the top
    const block = path.scope.getBlockParent();

    if (!block.path.isBlockStatement()) {
      return;
    }

    const [tmp] = block.path.unshiftContainer(
      'body',
      t.variableDeclaration('const', [
        t.variableDeclarator(
          decl.id,
          t.functionExpression(
            decl.id,
            decl.params,
            decl.body,
            decl.generator,
            decl.async,
          ),
        ),
      ]),
    );
    block.registerDeclaration(tmp);
  },
};

function hasConstantViolations(
  path: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): boolean {}

function transformPureFunction(
  program: NodePath<t.Program>,
  path: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): void {
  const expr = path.node;
  // Create a function declaration similar to this one
  const id = generateUniqueName(path, 'fn');
  const [tmp] = program.unshiftContainer('body', [
    t.functionDeclaration(
      id,
      expr.params,
      t.isExpression(expr.body)
        ? t.blockStatement([t.returnStatement(expr.body)])
        : expr.body,
      expr.generator,
      expr.async,
    ),
  ]);
  program.scope.registerDeclaration(tmp);
  // Create a binding call to that function
  path.replaceWith(
    t.callExpression(t.memberExpression(id, t.identifier('bind')), []),
  );
}

function getClosureObject(locals: Binding[]): t.ObjectExpression {
  const properties: t.ObjectProperty[] = [];

  for (let i = 0, len = locals.length; i < len; i++) {
    const identifier = locals[i].identifier;
    properties.push(t.objectProperty(identifier, identifier, false, true));
  }

  return t.objectExpression(properties);
}

function transformImpureFunction(
  program: NodePath<t.Program>,
  path: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
  locals: Binding[],
): void {
  path.traverse({
    ReferencedIdentifier(child) {
      const binding = child.scope.getBinding(child.node.name);
      if (binding && locals.includes(binding)) {
        child.replaceWith(
          t.memberExpression(t.thisExpression(), t.identifier(child.node.name)),
        );
      }
    },
  });
  const expr = path.node;
  // Create a function declaration similar to this one
  const func = generateUniqueName(path, 'fn');
  const [tmp] = program.unshiftContainer('body', [
    t.functionDeclaration(
      func,
      expr.params,
      t.isExpression(expr.body)
        ? t.blockStatement([t.returnStatement(expr.body)])
        : expr.body,
      expr.generator,
      expr.async,
    ),
  ]);
  program.scope.registerDeclaration(tmp);
  // Create a binding call to that function
  path.replaceWith(
    t.callExpression(t.memberExpression(func, t.identifier('bind')), [
      getClosureObject(locals),
    ]),
  );
}

function hasThisReference(
  path: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): boolean {
  let result = false;
  path.traverse({
    ThisExpression(child) {
      const functionParent = child.getFunctionParent();
      if (functionParent === path) {
        result = true;
        child.stop();
      }
    },
  });
  return result;
}

function transformFunction(
  program: NodePath<t.Program>,
  path: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): void {
  const parent = path.getStatementParent();
  if (!parent || isStatementTopLevel(parent)) {
    return;
  }
  if (hasThisReference(path)) {
    return;
  }
  // Get the bindings for this function
  const bindings = getForeignBindings(path, 'function');
  const locals: Binding[] = [];
  // Then we identify the bindings
  for (const binding of bindings) {
    const target = path.scope.getBinding(binding);
    if (target) {
      // Check if this has mutations
      if (!target.constant) {
        // Oh well, we give up (for now)
        return;
      }
      // Check if it's not a module
      if (target.kind !== 'module') {
        locals.push(target);
      }
    }
  }
  // No locals, actually pure
  if (locals.length === 0) {
    transformPureFunction(program, path);
  } else {
    transformImpureFunction(program, path, locals);
  }
}

const FUNCTION_TRANSFORM: Visitor<NodePath<t.Program>> = {
  ArrowFunctionExpression(path, program) {
    transformFunction(program, path);
  },
  FunctionExpression(path, program) {
    transformFunction(program, path);
  },
};

const PLUGIN: PluginObj = {
  visitor: {
    Program(program) {
      // First, bubble up all function declarations that are not top-level
      // and convert them into function expressions
      program.traverse(FUNCTION_BUBBLE);
      // Then we transform
      program.traverse(FUNCTION_TRANSFORM, program);
    },
  },
};

export function closuresToBindsPlugin(): PluginObj {
  return PLUGIN;
}
