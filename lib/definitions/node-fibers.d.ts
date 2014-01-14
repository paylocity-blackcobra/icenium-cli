// Type definitions for node-fibers
// Project: https://github.com/laverdet/node-fibers
// Definitions by: Cary Haynie <https://github.com/caryhaynie>
// Definitions: https://github.com/borisyankov/DefinitelyTyped

interface Fiber {
	reset: () => any;
	run: (param?: any) => any;
	throwInto: (ex: any) => any;
}

interface IFuture {
	detach(): void;
	get(): any;
	isResolved (): boolean;
	proxy(future: IFuture): void;
	proxyErrors(futureOrList: any): IFuture;
	resolver(): Function;
	resolve(fn: Function): void;
	resolveSuccess(fn: Function): void;
	return(result?: any): void;
	throw (error: any): void;
	wait (): any;
}

interface ICallableFuture extends IFuture {
	(...args: any[]): any;
}

declare module "fibers" {

	function Fiber(fn: Function): Fiber;

	module Fiber {
		export var current: Fiber;
		export function yield(value?: any): any
	}

export = Fiber;
}

declare module "fibers/future" {

	class Future implements IFuture {
		constructor();
		detach(): void;
		get(): any;
		isResolved (): boolean;
		proxy(future: IFuture): void;
		proxyErrors(futureOrList: any): IFuture;
		resolver(): Function;
		resolve(fn: Function): void;
		resolveSuccess(fn: Function): void;
		return(result?: any): void;
		throw (error: any): void;
		wait (): any;

		static wait(future: IFuture);
		static wait(future_list: IFuture[]);
		static wrap(fn: Function): ICallableFuture;
	}

export = Future;
}