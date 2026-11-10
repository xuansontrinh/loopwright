const noColor = !!process.env['NO_COLOR'];

const fmt = (code: string, text: string): string => (noColor ? text : `\x1b[${code}m${text}\x1b[0m`);

export const log = {
  info: (msg: string) => console.log(fmt('36', 'ℹ') + ' ' + msg),
  success: (msg: string) => console.log(fmt('32', '✔') + ' ' + msg),
  warn: (msg: string) => console.log(fmt('33', '⚠') + ' ' + msg),
  error: (msg: string) => console.error(fmt('31', '✖') + ' ' + msg),
  dim: (msg: string) => console.log(fmt('2', msg)),
  bold: (text: string): string => fmt('1', text),
};
