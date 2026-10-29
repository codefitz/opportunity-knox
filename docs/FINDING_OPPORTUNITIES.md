# Finding opportunities

Both Opportunities and Kanban board use the same filters. Changes update the visible results immediately, without changing saved records or calling AI. Selections remain when switching pages/views while the workspace is open; a reload returns to the default active view.

- Search looks at company, role, location and tags, ignoring case and surrounding whitespace.
- Outcome defaults to active opportunities; choose completed, all or a specific outcome to include closed records. Stage is an independent filter. All filter groups combine, so active-only plus Outcome stage has no matches.
- Tags supports multiple selections. Choose All selected tags or Any selected tag when more than one is selected. Case/whitespace variants match the same tag. Picker counts cover the whole workspace, count each opportunity once and do not shrink with other selections.
- Application deadlines can be passed, today, the next 7/30 days, any recorded deadline, or no recorded deadline. Next 7/30 includes today and the following 6/29 calendar days. Unknown/unusable dates count as no recorded deadline. Dates use the configured workspace timezone.
- A custom deadline range includes both bounds. Either bound may be empty; both empty match all recorded deadlines. A reversed or invalid range displays an explanation and no results until corrected or reset.
- Overdue actions only means work due before today, not today itself: an overview next action, an unfinished activity follow-up, a pending offer response or an incomplete linked to-do. Only active opportunities qualify; cancelled activity follow-ups, completed follow-ups, responded offers and unlinked tasks do not qualify. Multiple overdue actions still count the opportunity once.

Remove individual filter chips to broaden results, or use Reset filters to return to active opportunities with no other restrictions. The toolbar shows matching opportunities out of all saved records. Workspace totals above it stay unfiltered; the Overdue actions total counts active opportunities with at least one qualifying overdue action. Closed records remain available through the outcome selector.
