export class FilterSettings {
	doShowOrphans? = true;
	freezeLayout? = false;

	constructor(doShowOrphans?: boolean, freezeLayout?: boolean) {
		this.doShowOrphans = doShowOrphans ?? this.doShowOrphans;
		this.freezeLayout = freezeLayout ?? this.freezeLayout;
	}

	public static fromStore(store: Partial<FilterSettings> | undefined) {
		return new FilterSettings(store?.doShowOrphans, store?.freezeLayout);
	}

	public toObject() {
		return {
			doShowOrphans: this.doShowOrphans,
			freezeLayout: this.freezeLayout,
		};
	}
}
