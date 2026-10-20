import { openuiChatLibrary, openuiLibrary } from '@openuidev/react-ui';
import { withTeacherComponents } from '../../../desktop/src/common/openui/components';

const specOnly = { SlideOutline: (): null => null, FileCard: (): null => null };

const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/%3E';
const quote = JSON.stringify(image);

/** Explicit fixture membership makes newly added official components fail coverage checks. */
const groups = [
  {
    names: [
      'Card',
      'CardHeader',
      'TextContent',
      'MarkDownRenderer',
      'Callout',
      'TextCallout',
      'Image',
      'ImageBlock',
      'ImageGallery',
      'CodeBlock',
      'InlineHeader',
      'Separator',
    ],
    children: `CardHeader("Poetry lesson", "Tang dynasty"), TextContent("Read the poem"), MarkDownRenderer("**Lesson**"), Callout("info", "Read", "Compare the poets"), TextCallout("success", "Ready", "Lesson loaded"), Image("Poetry", ${quote}), ImageBlock(${quote}, "Poetry block"), ImageGallery([{src: ${quote}, alt: "Poetry gallery", details: "Lesson image"}]), CodeBlock("text", "A poem"), InlineHeader("Reading", "First stanza"), Separator()`,
  },
  {
    names: ['Tabs', 'TabItem', 'Accordion', 'AccordionItem', 'Steps', 'StepsItem', 'Carousel'],
    children:
      'Tabs([TabItem("one", "Li Bai", [TextContent("Moonlight")]), TabItem("two", "Du Fu", [TextContent("Spring")])]), Accordion([AccordionItem("reading", "Discussion", [TextContent("Compare imagery")])]), Steps([StepsItem("Read", "Read aloud"), StepsItem("Compare", "Find differences")]), Carousel([[TextContent("First poem")], [TextContent("Second poem")]])',
  },
  {
    names: ['Table', 'Col', 'EditableTable'],
    children:
      'Table([Col("Class", ["F1", "F2"]), Col("Students", [25, 30], "number")]), EditableTable("results", [{type: "text", key: "name", header: "Name"}, {type: "number", key: "score", header: "Score"}, {type: "select", key: "grade", header: "Grade", options: [{value: "F1", label: "F1"}]}, {type: "date-single", key: "date", header: "Date"}, {type: "url", key: "url", header: "Resource"}], [{id: "student", values: ["Learner", 80, "F1", "2026-10-20", "https://example.com"]}])',
  },
  {
    names: [
      'BarChart',
      'LineChart',
      'AreaChart',
      'RadarChart',
      'HorizontalBarChart',
      'Series',
      'PieChart',
      'RadialChart',
      'SingleStackedBarChart',
      'Slice',
      'ScatterChart',
      'ScatterSeries',
      'Point',
    ],
    children:
      'BarChart(["F1", "F2"], [Series("Students", [25, 30])]), LineChart(["Mon", "Tue"], [Series("Progress", [20, 40])]), AreaChart(["Mon", "Tue"], [Series("Progress", [20, 40])]), RadarChart(["Read", "Write", "Speak"], [Series("Skills", [80, 70, 90])]), HorizontalBarChart(["F1", "F2"], [Series("Students", [25, 30])]), PieChart([slice.category, "Chinese"], [slice.value, 40]), RadialChart(["Reading", "Writing"], [60, 40]), SingleStackedBarChart(["Reading", "Writing"], [60, 40]), ScatterChart([ScatterSeries("Scores", [Point(1, 80, 1), Point(2, 90, 2)])], "Attempt", "Score")',
    declarations: 'slice = Slice("English", 60)',
  },
  {
    names: [
      'Form',
      'FormControl',
      'Input',
      'TextArea',
      'Select',
      'SelectItem',
      'DatePicker',
      'Slider',
      'CheckBoxGroup',
      'CheckBoxItem',
      'RadioGroup',
      'RadioItem',
      'SwitchGroup',
      'SwitchItem',
      'Chips',
      'ChipItem',
      'OptionCards',
      'OptionCard',
      'Button',
      'Buttons',
      'IconButton',
      'Icon',
    ],
    children:
      'Form("lesson", Buttons([Button("Continue", @ToAssistant("Continue"))]), [FormControl("Topic", Input("topic", "Topic", "text", {required: true}, $topic)), FormControl("Notes", TextArea("notes", "Notes", 3)), FormControl("Class", Select("class", [SelectItem("F1", "F1"), SelectItem("F2", "F2")], "Choose a class")), FormControl("Date", DatePicker("date", "single")), FormControl("Marks", Slider("marks", "discrete", 0, 100, 1, [50], "Marks")), FormControl("Tasks", CheckBoxGroup("tasks", [CheckBoxItem("Read", "Read the poem", "read")])), FormControl("Poet", RadioGroup("poet", [RadioItem("Li Bai", "Tang", "libai"), RadioItem("Du Fu", "Tang", "dufu")])), FormControl("Themes", Chips("themes", "multiple", [ChipItem("moon", "Moon", Icon("moon")), ChipItem("spring", "Spring")])), FormControl("Lesson format", OptionCards("format", "single", [OptionCard("reading", "Reading", "Compare imagery", Icon("book-open")), OptionCard("writing", "Writing")]))]), SwitchGroup("options", [SwitchItem("Audio", "Read aloud", "audio", false)]), IconButton("Open reference", Icon("book-open"), @OpenUrl("https://example.com"))',
    declarations: '$topic = "Poetry"',
  },
  {
    names: [
      'TagBlock',
      'Tag',
      'EntityList',
      'ListBlock',
      'ListItem',
      'Text',
      'BoldText',
      'IconText',
      'ImageText',
      'ImageTextLarge',
      'MetricIndicatorInline',
      'MetricIndicatorWithStrikethrough',
      'SnippetCardItem',
      'SnippetCardBlock',
      'OverviewCardItem',
      'OverviewCardBlock',
      'ContextCardItem',
      'ContextCardBlock',
      'CompositeCardItem',
      'CompositeCardBlock',
      'VisualCardItem',
      'VisualCardBlock',
      'Label',
    ],
    children: `TagBlock(["Poetry", "F1"]), EntityList([{left: "Class", right: "F1"}]), CompositeCardBlock([CompositeCardItem("lesson", ImageTextLarge(${quote}, "Cover", "Poetry"), [Text("text", "Read"), BoldText("number", "80"), IconText(Icon("book-open"), "neutral", "md", "Notes"), ListBlock([ListItem("Li Bai", "Tang poet")])], {price: MetricIndicatorWithStrikethrough("80", "Marks", "60"), button: Button("Discuss", @ToAssistant("Discuss"))})]), SnippetCardBlock([SnippetCardItem("topic", ImageText(${quote}, "Poem", "Topic"), Text("text", "Poetry"))]), OverviewCardBlock([OverviewCardItem("progress", IconText(Icon("book-open"), "neutral", "md", "Progress"), MetricIndicatorInline("80", "Marks", {direction: "up", value: 5}))]), ContextCardBlock([ContextCardItem("context", Tag("Tang", Icon("book-open")), "Poetry context", "gray")]), VisualCardBlock([VisualCardItem(BoldText("text", "Moonlight"), "moon", ${quote}, Tag("Read"), "Moon")]), Form("label", Buttons([Button("Read")]), [FormControl("Poem", Input("poem", "Poem"), label.text)])`,
    declarations: 'label = Label("Read aloud")',
  },
  {
    names: ['SlideOutline', 'FileCard'],
    children:
      'SlideOutline("outline", [{title: "引入", points: ["朗讀第一段"], visual: "車站月台", notes: "提問：背影代表甚麼？"}, {title: "分析", points: ["父親攀月台"]}]), FileCard("qa/背影.pptx", "背影簡報", "兩教節")',
  },
];

/** Each program is valid for its official root and has non-empty, referenced sample data. */
export const catalogFixtures = (profile: 'openui' | 'openui-chat') => {
  const root = profile === 'openui' ? 'Stack' : 'Card';
  const fixtures = groups.map((group, index) => ({
    id: 'group-' + index,
    names: group.names,
    program: `root = ${root}([${profile === 'openui' && index === 0 ? `Card([${group.children}])` : group.children}])\n${group.declarations ?? ''}`,
  }));
  if (profile === 'openui')
    fixtures.push({
      id: 'modal',
      names: ['Stack', 'Modal'],
      program:
        'root = Stack([Buttons([Button("Open lesson", @Set($open, true))]), Modal("Lesson", $open, [TextContent("Modal poem")])])\n$open = false',
    });
  else
    fixtures.push({
      id: 'chat',
      names: ['FollowUpBlock', 'FollowUpItem', 'SectionBlock', 'SectionItem'],
      program:
        'root = Card([SectionBlock([SectionItem("poem", "Reading", [TextContent("Moonlight")])], true), FollowUpBlock([FollowUpItem("Compare poets")])])',
    });
  return {
    library: withTeacherComponents(profile === 'openui' ? openuiLibrary : openuiChatLibrary, specOnly),
    fixtures,
  };
};
