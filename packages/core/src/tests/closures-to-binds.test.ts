import { describe, expect, it } from 'vitest';
import { closuresToBindsPlugin } from '../closures-to-binds';
import { compile } from './compile';

describe('closures-to-binds', () => {
  describe('FunctionExpression', () => {
    it('should compile', async () => {
      const example = `
      function foo(arr) {
        const example = () => console.log(arr);
      }
      `;

      expect(
        await compile([[closuresToBindsPlugin]], example),
      ).toMatchSnapshot();
    });
  });
});
