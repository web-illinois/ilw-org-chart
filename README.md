# ilw-org-chart

Links: **[ilw-org-chart in Builder](https://builder3.toolkit.illinois.edu/component/ilw-org-chart/index.html)** |
[Illinois Web Theme](https://webtheme.illinois.edu/) |
[Toolkit Development](https://github.com/web-illinois/toolkit-management)

## Overview

This component renders an organization chart based on simple JSON of the organization's
entities. The only required data is the title and parent for each entity. Here's a
minimal example:
 
```json
{
    "title": "Vice Chancellor for Student Affairs",
    "children": [
        {
            "title": "Administrative Assistant"
        },
        {
            "title": "Associate Vice Chancellor for Student Success and Engagement",
            "children": [
                { "title": "Director, Illinois Leadership Center" },
                { "title": "Director, Minority Student Affairs" }
            ]
        }
    ]
}
```

The component renders an org chart to fit into a given space, laying it out automatically
to make it fit as well as possible.

## Code Examples

```html
<ilw-org-chart></ilw-org-chart>
```

## Accessibility Notes and Use

Nothing yet.
