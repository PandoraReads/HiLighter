export class AutosaveQueue<T> {
    private pending: T | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private chain: Promise<void> = Promise.resolve();

    constructor(private readonly save: (value: T) => Promise<void>, private readonly onError: (error: unknown) => void, private readonly delay = 600) {}

    schedule(value: T): void {
        this.pending = value;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.flush(); }, this.delay);
    }

    flush(): Promise<void> {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        const value = this.pending;
        this.pending = undefined;
        if (value !== undefined) this.chain = this.chain.then(() => this.save(value)).catch(error => { this.onError(error); });
        return this.chain;
    }
}
