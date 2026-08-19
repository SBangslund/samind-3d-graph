export class FilterSettings {
	doShowOrphans? = true;

	constructor(doShowOrphans?: boolean) {
		this.doShowOrphans = doShowOrphans ?? this.doShowOrphans;
	}

	public static fromStore(store: Partial<FilterSettings> | undefined) {
		return new FilterSettings(store?.doShowOrphans);
	}

	public toObject() {
		return {
			doShowOrphans: this.doShowOrphans,
		};
	}
}
