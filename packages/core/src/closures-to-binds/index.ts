import type { NodePath, PluginObj, Visitor } from '@babel/core';
import type { Binding } from '@babel/traverse';
import * as t from '@babel/types';
import { generateUniqueName } from '../shared/generate-unique-name';
import getForeignBindings from '../shared/get-foreign-bindings';
import { isStatementTopLevel } from '../shared/is-statement-top-level';

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
  // Replace all local references with the closure object access
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

// A <- B <- C <- this

function hasThisReference(
  path: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): boolean {
  let result = false;
  path.traverse({
    ThisExpression(child) {
      let current: NodePath | null = child.parentPath;
      while (current) {
        if (current === path) {
          result = true;
          child.stop();
          break;
        }
        if (current.isFunctionExpression() || current.isFunctionDeclaration()) {
          break;
        }
        current = current.parentPath;
      }
    },
  });
  return result;
}

function isValidLocalBinding(binding: Binding): boolean {
  if (binding.kind === 'module') {
    return false;
  }
  let blockParent = binding.path.scope.getBlockParent();
  const programParent = binding.path.scope.getProgramParent();
  // a FunctionDeclaration binding refers to itself as the block parent
  if (blockParent.path === binding.path) {
    blockParent = blockParent.parent;
  }
  return blockParent !== programParent;
}

function transformFunction(
  program: NodePath<t.Program>,
  path: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): void {
  const parent = path.getStatementParent();
  if (
    !parent ||
    (isStatementTopLevel(parent) && !parent.isClassDeclaration())
  ) {
    return;
  }
  // There's a this reference, skip
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
      if (!target.constant) {
        return;
      }
      if (isValidLocalBinding(target)) {
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
      program.traverse(FUNCTION_TRANSFORM, program);
    },
  },
};

export function closuresToBindsPlugin(): PluginObj {
  return PLUGIN;
}
