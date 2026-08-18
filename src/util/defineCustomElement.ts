// Hot-reloading the plugin re-evaluates its module each time, producing a
// brand new class object for anything extending a built-in element. But
// customElements.define can only ever bind one constructor to a given tag
// name for the lifetime of the page - reusing the same name across reloads
// either throws (duplicate definition) or, if guarded away as before,
// leaves the registry pointing at a stale constructor from an earlier
// reload while `new CurrentClass()` uses the fresh one, which throws
// "Illegal constructor". Registering under a fresh unique name whenever a
// prior registration is found sidesteps both, since nothing else ever
// references the tag string - these classes are only ever instantiated
// directly via `new`.
export function defineCustomElement(
	baseName: string,
	ctor: CustomElementConstructor,
	options?: ElementDefinitionOptions
): void {
	const tagName =
		customElements.get(baseName) === undefined
			? baseName
			: `${baseName}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
	customElements.define(tagName, ctor, options);
}
