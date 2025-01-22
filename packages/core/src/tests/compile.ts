import * as babel from '@babel/core';

export async function compile(
  plugins: babel.PluginItem[],
  code: string,
): Promise<string> {
  const result = await babel.transformAsync(code, {
    plugins,
    parserOpts: {
      plugins: ['jsx'],
    },
  });

  return result?.code ?? '';
}
