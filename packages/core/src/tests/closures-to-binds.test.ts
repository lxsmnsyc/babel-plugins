import { describe, expect, it } from 'vitest';
import { closuresToBindsPlugin } from '../closures-to-binds';
import { compile } from './compile';

describe('closures-to-binds', () => {
  describe('FunctionExpression', () => {
    it('should compile', async () => {
      const example = `
      function test() {
        let example = 0;

        const foo = () => () => () => example;

        example++;
      }
      `;

      expect(
        await compile([[closuresToBindsPlugin]], example),
      ).toMatchSnapshot();
    });
  });
});
