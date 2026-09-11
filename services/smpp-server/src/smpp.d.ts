declare module 'smpp' {
  const smpp: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createServer(fn: (session: any) => void): { listen(port: number, host: string, cb?: () => void): void; emit: unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connect(opts: Record<string, unknown>, cb?: () => void): any;
  };
  export default smpp;
}
