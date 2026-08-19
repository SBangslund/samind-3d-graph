import ObservableSlim from "observable-slim";

// ====================================================== //
// ====================== State ====================== //
// ====================================================== //

// Wrapper class to make any object/primitive observable

export type StateListener = (changeData: StateChange) => void;

// observable-slim ships no types; this is the shape of the proxy it
// hands back from ObservableSlim.create().
interface ObservableSlimProxy<T> {
	__getTarget: T;
	__getProxy: ProxyConstructor;
}

export default class State<T> {
	private readonly listeners = new Map<number, StateListener>();
	private static listener_count = 0;

	private val: ProxyConstructor | T;
	private static stateCount = 0;
	readonly id: number;

	constructor(value: T) {
		State.stateCount++;
		this.id = State.stateCount;

		this.val =
			typeof value === "object"
				? ObservableSlim.create(value, false, this.onValueChange)
				: value;
	}

	get value(): T {
		return this.val as T;
	}

	set value(val: T) {
		const previousValue = this.val;
		if (typeof val !== "object") {
			this.val = val;
		} else {
			this.val = ObservableSlim.create(val, false, this.onValueChange);
		}
		this.onValueChange([
			{
				type: "update",
				property: "",
				currentPath: "",
				jsonPointer: "",
				target: this.val,
				proxy: (this.val as unknown as ObservableSlimProxy<T>)
					.__getProxy,
				previousValue,
				newValue: this.val,
			},
		]);
	}

	public onChange = (
		callback: (change: StateChange) => void
	): (() => void) => {
		const listenerId = this.generateListenerId();
		this.listeners.set(listenerId, callback);
		return () => this.unsubscribe(listenerId); // return unsubscribe function
	};

	public createSubState<S>(
		key: string,
		type: new (...a: never) => S
	): State<S> {
		const subStateKeys = key.split(".");
		const subStateValue: unknown = subStateKeys.reduce<unknown>(
			(obj, key) => {
				const val = (obj as Record<string, unknown>)[key];
				if (val !== undefined) {
					return val;
				}
				throw new InvalidStateKeyError(key, this);
			},
			this
		);
		if (typeof subStateValue === "object" && subStateValue !== null) {
			// check if is like generic type S
			if (subStateValue instanceof type) {
				return new State(
					(subStateValue as unknown as ObservableSlimProxy<S>)
						.__getTarget
				);
			} else {
				throw new Error(
					`Substate ${key} of state ${this.id} is not of type ${type.name}`
				);
			}
		} else
			throw new Error(
				"SubStates of properties that are Primitives are not supported yet."
			);
	}

	public getRawValue(): T {
		if (typeof this.val === "object") {
			return (this.val as unknown as ObservableSlimProxy<T>)
				.__getTarget;
		}
		return this.val as T;
	}

	private generateListenerId = () => {
		State.listener_count++;
		return State.listener_count;
	};

	private unsubscribe = (listenerId: number) => {
		this.listeners.delete(listenerId);
	};

	private notifyAll = (changeData: StateChange) => {
		this.listeners.forEach((listener) => listener(changeData));
	};

	private onValueChange = (changes: StateChange[]) => {
		changes.forEach((change) => {
			this.notifyAll(
				Object.assign({}, change, { triggerStateId: this.id })
			);
		});
	};
}

// custom error type for invalid state keys
export class InvalidStateKeyError<T> extends Error {
	constructor(subStateKey: string, state: State<T>) {
		super();
		this.message = `Key does not exist!
    Detailed error:
    ${subStateKey} could not be found in "value":${JSON.stringify(state.value)}
    `;
	}
}

export interface StateChange {
	type: "add" | "delete" | "update";
	property: string; // equals "value" if the whole state is changed

	currentPath: string; // path of the property
	jsonPointer: string; // path as json pointer syntax
	target: unknown; // the target object
	proxy?: ProxyConstructor; // the proxy of the object

	previousValue?: unknown; // may be undefined if the property is new
	newValue?: unknown; // may be undefined if the property is deleted
}
