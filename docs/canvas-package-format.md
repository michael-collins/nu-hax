# Canvas Course Export Package (.imscc) — generator spec

Authority: `instructure/canvas-lms` master @ `1c9f0bb8` (commit date 2026-04-30), read from a sparse clone. Paths below are repo-relative; `L` = line numbers at that commit.
Abbreviations: **EXP** = what Canvas's exporter writes, **IMP** = what the Canvas-flavoured importer actually reads/does. When they differ, IMP wins for a generator.
UNVERIFIED = not traced to code (or the code is closed-source).

Core files:
- Exporter: `lib/cc/cc_helper.rb`, `manifest.rb`, `organization.rb`, `resource.rb`, `canvas_resource.rb`, `module_meta.rb`, `assignment_groups.rb`, `rubrics.rb`, `assignment_resources.rb`, `wiki_resources.rb`, `web_links.rb`, `web_resources.rb`, `topic_resources.rb`, `events.rb`, `qti/qti_generator.rb`, `qti/qti_items.rb`
- Importer (package → JSON): `lib/cc/importer/canvas/{converter,course_settings,module_converter,rubrics_converter,assignment_converter,wiki_converter,topic_converter,quiz_converter,quiz_metadata_converter,webcontent_converter}.rb`, `lib/cc/importer/standard/assignment_converter.rb`, `lib/canvas/migration/{package_identifier,migrator,xml_helper,migrator_helper}.rb`
- Importer (JSON → DB): `app/models/importers/*_importer.rb`, `app/models/content_migration.rb`
- XSD: `lib/cc/xsd/cccv1p0.xsd` (target namespace `http://canvas.instructure.com/xsd/cccv1p0`). Canvas never validates imports against it (`lib/cc/schema.rb` only serves the file); it is useful as a field reference.
- Sanitizer: `gems/canvas_sanitize/lib/canvas_sanitize/canvas_sanitize.rb`

---

## 0. Ten rules that matter most (summary of pitfalls proven in code)

1. **Detection.** Manifest `<metadata><schema>` must match `/IMS(?: Thin)? Common Cartridge/i`, and there must be a `<resource href="course_settings/canvas_export.txt">`. Without the marker the package is routed to the *generic* CC importer, whatever option the user picked in the dialog (`lib/canvas/migration/package_identifier.rb` L52-68, L120-126; `CCWorker` picks the converter from the package, `lib/cc/importer/cc_worker.rb` L43-52).
2. **Fixed paths, not the manifest.** Canvas reads `course_settings/*.xml`, `course_settings/syllabus.html`, every file under `wiki_content/`, and every file under `non_cc_assessments/` **by path**. The manifest drives only assignments, quiz metadata, discussions and files (§1.4).
3. **Element order matters.** The importer uses `at_css("name")`, which returns the *first descendant*, so a parent's scalar fields must come **before** any nested block that reuses the same element name. In practice, write parent fields before `<items>`, `<prerequisites>`, `<ratings>` and the nested `<assignment>` (§3, §5, §8). The order shown in the examples here is safe.
4. **Missing referenced files crash the whole import**, not just the item. `open_file`/`open_file_xml` returns nil and the next call raises; there is no rescue in `Converter#export` (assignments: `lib/cc/importer/canvas/assignment_converter.rb` L28-44; topics: `topic_converter.rb` L28-36).
5. **Wiki pages need `<meta name="identifier">` and a `<title>`**, or they are silently skipped (`wiki_page_importer.rb` L235, L251).
6. **Assignments need `<grading_type>`**, or `points_possible` is ignored (`assignment_importer.rb` L178-180).
7. **Graded quizzes need a nested `<assignment identifier=…>`** in `assessment_meta.xml`. For Canvas packages, Canvas will not build one for you (`quiz_importer.rb` L249-302; `canvas_import?` is true for this converter, `content_migration.rb` L266).
8. **Rubrics need an explicit `<points_possible>`.** It is stored as given (`.to_f`, so missing = 0) and never recomputed (`rubric_importer.rb` L74, L106).
9. **Module items that aren't backed by content** (ExternalUrl, ContextModuleSubHeader) import **unpublished** unless the item's `<workflow_state>` is `active` (`context_module.rb` add_item L815/L869 + `context_module_importer.rb` L377-383).
10. **Dates** are `YYYY-MM-DDTHH:MM:SS`, **UTC, with no offset**. Canvas parses them as UTC (`xml_helper.rb` L25-33, L90-92). Convert local course time to UTC yourself, DST included.

---

## 1. Package layout and `imsmanifest.xml`

### 1.1 Layout (what Canvas writes; `cc_helper.rb` L76-107)
```
imsmanifest.xml
course_settings/
  canvas_export.txt          # marker (content irrelevant; Canvas writes a panda joke)
  course_settings.xml
  module_meta.xml
  assignment_groups.xml
  rubrics.xml
  events.xml                 # calendar events (§11)
  files_meta.xml             # optional
  syllabus.html              # optional
  context.xml                # optional, source-course info; omit
wiki_content/<page-slug>.html
<assignment_id>/<title-slug>.html
<assignment_id>/assignment_settings.xml
<quiz_id>/assessment_qti.xml          # CC-profile QTI (not read by Canvas importer)
<quiz_id>/assessment_meta.xml
non_cc_assessments/<quiz_id>.xml.qti  # Canvas-flavoured QTI 1.2 (what Canvas imports)
<topic_id>.xml + <topic_meta_id>.xml  # discussions
<weblink_id>.xml                      # CC web links (not read by Canvas importer)
web_resources/<course files tree>
```
- The zip extension is `.imscc` (`CC_EXTENSION`); a `.zip` also works. Put `imsmanifest.xml` at the zip root. A single wrapping folder is tolerated (`lib/canvas/migration/archive.rb` L44-60). `__MACOSX`, `.DS_Store` and `thumbs.db` are ignored (`lib/unzip_attachment.rb` L24).
- Course files are imported **only** if they are declared as `webcontent` resources whose `href` starts with `web_resources/` (`webcontent_converter.rb` L27-35, `course_content_importer.rb` L24-72). Nothing else in the zip becomes a course file.

### 1.2 Manifest root and metadata (`manifest.rb` L50-142; fixture `spec/fixtures/importer/unzipped/imsmanifest.xml`)
Canvas writes CC **1.1.0** by default (`cc_version`, L114-121). Use it.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="gMANIFEST"
  xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"
  xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource"
  xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imscp_v1p2_v1p0.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lomresource_v1p0.xsd http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest http://www.imsglobal.org/profile/cc/ccv1p1/LOM/ccv1p1_lommanifest_v1p0.xsd">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.1.0</schemaversion>
    <lomimscc:lom><lomimscc:general><lomimscc:title>
      <lomimscc:string>My Course</lomimscc:string>
    </lomimscc:title></lomimscc:general></lomimscc:lom>   <!-- optional -->
  </metadata>
  <organizations>…</organizations>
  <resources>…</resources>
</manifest>
```
The importer runs `remove_namespaces!` on the manifest (`converter.rb` L52), so prefixes don't matter to it. They do matter to strict CC validators.

### 1.3 `<organizations>` (`organization.rb` L40-85)
**IMP: the Canvas converter never reads `<organizations>`.** Modules come only from `module_meta.xml` (grep shows no use in `lib/cc/importer/canvas/`). Write it anyway for CC compliance:
```xml
<organizations>
  <organization identifier="org_1" structure="rooted-hierarchy">
    <item identifier="LearningModules">
      <item identifier="gMOD1">                       <!-- module key -->
        <title>Week 1</title>
        <item identifier="gTAG1" identifierref="gPAGE1"><title>Overview</title></item>
        <item identifier="gTAG2"><title>Readings</title></item>  <!-- sub-header: no identifierref -->
        <item identifier="gTAG3" identifierref="gWEBLINK3"><title>Zoom</title></item> <!-- ExternalUrl → weblink resource -->
      </item>
    </item>
  </organization>
</organizations>
```

### 1.4 Resources: types, and which ones the importer uses (`cc_helper.rb` L42-67)

| Content | `type` | `href` / files | Importer finds it by |
|---|---|---|---|
| course_settings bundle | `associatedcontent/imscc_xmlv1p1/learning-application-resource` (LOR) | `href="course_settings/canvas_export.txt"`; `<file>` for each course_settings file + marker | Detection only (`package_identifier.rb` L57-58). Settings files are read by fixed path (`course_settings.rb` L29-59). |
| Syllabus | LOR, `intendeduse="syllabus"` | `course_settings/syllabus.html` | Fixed path (`course_settings.rb` L43-45). |
| Wiki page | `webcontent` | `wiki_content/<slug>.html` | Scans the `wiki_content/` directory (`wiki_converter.rb` L24-36). The manifest entry is optional for import but recommended. |
| Assignment | LOR | `href="<id>/<slug>.html"`; files: the `.html` **and** `<id>/assignment_settings.xml` | LOR resources that have a `file[href$="assignment_settings.xml"]` **and** a `file[href$="html"]` (`assignment_converter.rb` L28-32). |
| Quiz (CC QTI) | `imsqti_xmlv1p2/imscc_xmlv1p1/assessment` | file `<id>/assessment_qti.xml`; `<dependency identifierref="<meta id>">` | Not used by the Canvas importer. |
| Quiz meta | LOR | `href="<id>/assessment_meta.xml"`; files: that + `non_cc_assessments/<id>.xml.qti` | A LOR whose `<file>` ends with `assessment_meta.xml` and whose path is exactly `<quiz migration id>/assessment_meta.xml` (`quiz_metadata_converter.rb` L28-37). The QTI itself is read from the `non_cc_assessments/` directory (`quiz_converter.rb` L25-33). |
| Discussion | `imsdt_xmlv1p1` (exact match) | file `<id>.xml`; `<dependency identifierref="<meta id>">` | `topic_converter.rb` L28-36 |
| Discussion meta | LOR | `<meta id>.xml` | via dependency |
| Web link | `imswl_xmlv1p1` | file `<id>.xml` | Not used by the Canvas importer. ExternalUrl comes from module_meta `<url>`. |
| File | `webcontent` | `href="web_resources/…"` (must equal the `<file href>`) | `webcontent_converter.rb` L27 |

The course_settings resource, exactly as Canvas writes it (`canvas_resource.rb` L67-93):
```xml
<resource identifier="gCOURSE" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="course_settings/canvas_export.txt">
  <file href="course_settings/course_settings.xml"/>
  <file href="course_settings/module_meta.xml"/>
  <file href="course_settings/assignment_groups.xml"/>
  <file href="course_settings/rubrics.xml"/>
  <file href="course_settings/events.xml"/>
  <file href="course_settings/files_meta.xml"/>
  <file href="course_settings/canvas_export.txt"/>
</resource>
<resource identifier="gCOURSE_syllabus" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="course_settings/syllabus.html" intendeduse="syllabus">
  <file href="course_settings/syllabus.html"/>
</resource>
```

### 1.5 Identifiers
- EXP: `CCHelper.create_key(obj, prepend="")` = `("g" if global else "i") + MD5_hex(prepend + asset_string)`, e.g. `g3f2…` (33 chars) (`cc_helper.rb` L119-129; global flag from `content_export.rb` L470-477). Derived keys use a prepend: quiz meta `create_key(quiz,"canvas_")`, topic meta `create_key(topic,"meta")`, weblink `create_key(tag,"weblink")`.
- IMP: identifiers are opaque `migration_id` strings. No format check, no XSD validation. **The format is arbitrary.** What is required:
  - **Unique across the whole manifest** (resources + organization items). `get_all_resources` keys a hash by identifier, so a later duplicate overwrites the earlier one (`migrator.rb` L112-141). It is also an XML `xs:ID`, so it must start with a letter or `_` and contain no spaces or colons. `g`/`i` + 32 hex satisfies this. Keep it ≤ 255 chars (it is a DB string column; UNVERIFIED exact limit).
  - **The same value in every place an object is referenced**:
    - Assignment: folder name = resource `identifier` = `<assignment identifier>` = module item `<identifierref>` = rubric/group refs.
    - Quiz: resource id = `<assessment ident>` in the QTI = folder of `assessment_meta.xml` = `<quiz identifier>` = `non_cc_assessments/<id>.xml.qti` = module item `identifierref`.
    - Wiki page: `<meta name="identifier">` is the migration id (the manifest resource id is **not** used), and it must equal the module item `identifierref`.
    - Discussion: the meta `<topic_id>` is the migration id (`topic_converter.rb` L55-56).
- **Make ids deterministic** (hash of a stable source id). On re-import, Canvas matches existing rows **by migration_id** and updates them in place. This applies to pages, assignments, modules, module items, groups, rubrics and events (each `*_importer.rb` `where(migration_id:)`). Module items missing from the new package are deleted (`context_module_importer.rb` L175-180). **Quizzes are the exception:** if a quiz with the same migration_id already exists, the id gets a prefix and you get a **duplicate**, unless `settings[overwrite_quizzes]=true` (`content_migration.rb` L528-533, `content_importer_helper.rb` L23-41). The Canvas Course Export Package form does not offer the "Overwrite assessment content with matching IDs" checkbox (it is passed only by the CC/QTI/Blackboard forms: `ui/features/content_migrations/react/components/migrator_forms/*.tsx`). Over the API it is a documented parameter (`content_migrations_controller.rb` L307-309).
- **Collisions with existing content:** assignment groups with no migration_id are matched **by name** (e.g. the default "Assignments" group gets reused and renamed in place) (`assignment_group_importer.rb` L76-81, L111).

---

## 2. `course_settings/course_settings.xml`
EXP `canvas_resource.rb` L187-281; IMP `course_settings.rb` L61-167; applied in `course_content_importer.rb` L536-664.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<course identifier="gCOURSE" xmlns="http://canvas.instructure.com/xsd/cccv1p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <title>Intro to X</title>
  <course_code>X-101</course_code>
  <start_at>2026-09-01T05:00:00</start_at>
  <conclude_at>2026-12-20T05:59:00</conclude_at>
  <default_view>modules</default_view>          <!-- feed|wiki|modules|assignments|syllabus -->
  <group_weighting_scheme>percent</group_weighting_scheme>  <!-- percent|equal -->
  <time_zone>America/Chicago</time_zone>
  <hide_final_grade>false</hide_final_grade>
</course>
```
- **`title`, `course_code`, `start_at` and `conclude_at` are NOT applied** to the target course on a normal import. They are in `COURSE_NO_COPY_ATTS` (`migrator_helper.rb` L30), and start/conclude are only applied for blueprint syncs (`course_content_importer.rb` L577-580). Write them for fidelity only.
- Applied attributes are `Course.clonable_attributes` minus the no-copy list (`app/models/course.rb` L3166-3219). These include `default_view`, `group_weighting_scheme`, `default_wiki_editing_roles`, `hide_final_grade`, `allow_student_*`, `show_total_grade_as_points`, `default_due_time`, `syllabus_course_summary`, `public_syllabus`, `restrict_*`, `course_color`, `license`, `locale`, and others. `time_zone` is applied explicitly (L627-629); Canvas exports it only when it differs from the account default (`canvas_resource.rb` L254-256). Value: a Rails or IANA zone name (UNVERIFIED that every IANA name is accepted; `America/Chicago` is safe).
- Settings apply **only if** the user chose "All content" or ticked "Course Settings" in selective import (`course_content_importer.rb` L190-195).
- `default_view=wiki` requires a **published** front page (`course.rb` L806-812; `wiki_page.rb` L172-175). Otherwise `course.save!` fails late in the import. If you use it, mark exactly one page `front_page=true` and `workflow_state=active` (§7).
- Booleans parse with `/true|yes|t|y|1/i` (substring match) (`xml_helper.rb` L62-64). Write `true`/`false`.

---

## 3. `course_settings/module_meta.xml`
EXP `module_meta.rb` L17-122; IMP `module_converter.rb` L24-83 → `context_module_importer.rb` L110-399; XSD L401-470.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<modules xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <module identifier="gMOD2">
    <!-- module scalars FIRST (see rule 3) -->
    <title>Week 2: Methods</title>
    <workflow_state>active</workflow_state>          <!-- active|unpublished -->
    <position>2</position>                           <!-- ALWAYS emit: else at_css picks an item's <position> -->
    <unlock_at>2026-09-08T05:00:00</unlock_at>       <!-- UTC; omit for none -->
    <require_sequential_progress>true</require_sequential_progress>
    <requirement_count></requirement_count>          <!-- omit/empty = all requirements; 1 = "complete one" -->
    <locked>false</locked>                           <!-- EXP only; ignored by IMP -->
    <prerequisites>
      <prerequisite type="context_module">
        <title>Week 1: Orientation</title>
        <identifierref>gMOD1</identifierref>           <!-- must be a module EARLIER in this file -->
      </prerequisite>
    </prerequisites>
    <items>
      <item identifier="gTAG21">
        <content_type>WikiPage</content_type>
        <workflow_state>active</workflow_state>
        <title>Week 2 overview</title>
        <identifierref>gPAGE21</identifierref>       <!-- = page <meta name="identifier"> -->
        <position>1</position>
        <new_tab/>
        <indent>0</indent>
        <link_settings_json>null</link_settings_json>
      </item>
      <item identifier="gTAG22">
        <content_type>ContextModuleSubHeader</content_type>
        <workflow_state>active</workflow_state>
        <title>Do this week</title>
        <position>2</position><new_tab/><indent>0</indent>
      </item>
      <item identifier="gTAG23">
        <content_type>ExternalUrl</content_type>
        <workflow_state>active</workflow_state>      <!-- REQUIRED to publish (rule 9) -->
        <title>Live session (Zoom)</title>
        <identifierref>gWEBLINK23</identifierref>
        <url>https://example.zoom.us/j/123</url>
        <position>3</position>
        <new_tab>true</new_tab>
        <indent>1</indent>
      </item>
      <item identifier="gTAG24">
        <content_type>Assignment</content_type>
        <workflow_state>active</workflow_state>
        <title>Problem set 2</title>
        <identifierref>gASSN24</identifierref>
        <position>4</position><new_tab/><indent>1</indent>
      </item>
      <item identifier="gTAG25">
        <content_type>Quizzes::Quiz</content_type>
        <workflow_state>active</workflow_state>
        <title>Check-in quiz</title>
        <identifierref>gQUIZ25</identifierref>
        <position>5</position><new_tab/><indent>1</indent>
      </item>
    </items>
    <completionRequirements>
      <completionRequirement type="must_view"><identifierref>gTAG21</identifierref></completionRequirement>
      <completionRequirement type="must_view"><identifierref>gTAG23</identifierref></completionRequirement>
      <completionRequirement type="must_submit"><identifierref>gTAG24</identifierref></completionRequirement>
      <completionRequirement type="min_score"><min_score>7.0</min_score><identifierref>gTAG25</identifierref></completionRequirement>
    </completionRequirements>
  </module>
</modules>
```
Field semantics (IMP):
- **Module**
  - `workflow_state`: `unpublished` → unpublished, anything else → `active` (L127-131).
  - `position`: offset after the course's existing modules (L133-139).
  - `unlock_at`: set if present (L142-145). It is shifted by "Adjust events and due dates" (`course_content_importer.rb` L431-434).
  - `require_sequential_progress`: bool. `requirement_count`: int.
  - Prerequisites: resolved by looking up a module with that `migration_id` that has **already been imported**, so prerequisite modules must come earlier in the file (L148-157). `type` is `context_module`.
- **Items** (L201-399)
  - `content_type` is matched by regex (L26-41):
    - `WikiPage` → page
    - `Attachment` → file
    - `Assignment` → assignment
    - `DiscussionTopic` → discussion
    - `Quizzes::Quiz` → classic quiz (`/assessment|quiz/`)
    - `ContextModuleSubHeader` → text header
    - `ExternalUrl` → URL (`/url/`)
    - `ContextExternalTool` → LTI
  - `identifierref` = the **content's** migration id. If the referenced content isn't found, the item is silently dropped.
  - `title`: content-backed items take the content's title first (`wiki.title.presence || hash[:title]`).
  - `indent`: int. `new_tab`: bool (L370).
  - `url`: ExternalUrl only. It must pass `CanvasHttp.validate_url`, i.e. absolute http(s); otherwise you get a warning and the item is skipped (L264-282).
  - `position` is **ignored**; order = document order (L371-374).
  - `workflow_state`: for content-backed items, the item's state follows the content's own state (`sync_workflow_state_to_asset?`, `content_tag.rb` L559-561). Publish the page/assignment/quiz itself. For ExternalUrl and SubHeader, `add_item` creates them `unpublished` and the importer then copies `<workflow_state>`, so write `active`.
- **completionRequirement** (L183-196; validation `context_module.rb` L567-588)
  - `identifierref` is the **module item's `identifier`** (gTAG…), **not** the content id.
  - Types: `must_view`, `must_mark_done`, `must_contribute` (any item); `must_submit`, `min_score`, `min_percentage` (only scoreable items: assignments, quizzes, graded discussions; `content_tag.rb` L275-277). `<min_score>` (float) only with `min_score`, `<min_percentage>` only with `min_percentage`.
  - Requirements that are invalid for an item are silently dropped.
- **Asynchronous weekly unlock pattern:** one module per week, each with `unlock_at` = Monday 00:00 local converted to UTC, `prerequisites` → previous module, `require_sequential_progress=true`, and a requirement on every item that students must do in order. Use `must_view` for pages, URLs and files; `must_mark_done` for pages you want explicitly ticked; `must_submit` for assignments and quizzes. Sub-headers get no requirement. "In order" only gates items that **have** a requirement (Canvas behaviour, UNVERIFIED in code beyond `require_sequential_progress` storage).

---

## 4. `course_settings/assignment_groups.xml` and weighting
EXP `assignment_groups.rb` L22-80; IMP `course_settings.rb` L173-196 → `assignment_group_importer.rb` L24-103; XSD L566-603.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<assignmentGroups xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <assignmentGroup identifier="gAG1">
    <title>Problem Sets</title>
    <position>1</position>
    <group_weight>40.0</group_weight>
    <rules>
      <rule><drop_type>drop_lowest</drop_type><drop_count>1</drop_count></rule>
      <rule><drop_type>never_drop</drop_type><identifierref>gASSN24</identifierref></rule>
    </rules>
  </assignmentGroup>
  <assignmentGroup identifier="gAG2"><title>Quizzes</title><position>2</position><group_weight>60.0</group_weight></assignmentGroup>
</assignmentGroups>
```
- Weights take effect only when course_settings has `<group_weighting_scheme>percent</group_weighting_scheme>` (`course.rb` L1500-1501 `apply_group_weights?`) **and** course settings are imported (§2).
- `drop_type`: `drop_lowest` | `drop_highest` (+`drop_count`) | `never_drop` (+`identifierref` = assignment id). `never_drop` is discarded when there are no drop rules (L95-97).
- An assignment whose `assignment_group_identifierref` is missing or unknown lands in an auto-created "Imported Assignments" group (`assignment_importer.rb` L785-790).
- A group with the same **name** and no migration_id in the target course is reused (§1.5).

---

## 5. `course_settings/rubrics.xml`
EXP `rubrics.rb` L22-124; IMP `rubrics_converter.rb` L24-73 → `rubric_importer.rb` L39-110; XSD L718-760 (+ratingsType).
```xml
<?xml version="1.0" encoding="UTF-8"?>
<rubrics xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <rubric identifier="gRUB1">
    <title>Problem set rubric</title>              <!-- rubric scalars FIRST -->
    <reusable>false</reusable>
    <public>false</public>
    <points_possible>10.0</points_possible>       <!-- REQUIRED: stored as-is (rule 8) -->
    <hide_score_total>false</hide_score_total>
    <free_form_criterion_comments>false</free_form_criterion_comments>
    <rating_order>descending</rating_order>      <!-- descending|ascending -->
    <description>Optional rubric description</description>
    <criteria>
      <criterion>
        <criterion_id>_1001</criterion_id>       <!-- before <ratings> -->
        <points>6.0</points>                     <!-- before <ratings> (ratings also have <points>) -->
        <description>Correctness</description>   <!-- before <ratings> -->
        <long_description>All steps shown</long_description>
        <criterion_use_range>false</criterion_use_range>
        <ratings>                                <!-- LAST -->
          <rating><description>Full marks</description><points>6.0</points><criterion_id>_1001</criterion_id><id>_2001</id></rating>
          <rating><description>Partial</description><points>3.0</points><criterion_id>_1001</criterion_id><id>_2002</id></rating>
          <rating><description>No marks</description><points>0.0</points><criterion_id>_1001</criterion_id><id>_2003</id></rating>
        </ratings>
      </criterion>
      <!-- … more criteria; sum of criterion points = rubric points_possible -->
    </criteria>
  </rubric>
</rubrics>
```
- `criterion_id` and rating `id` are free strings. They must be unique within the rubric and stable (saved comments key on `criterion_id`). Canvas uses `_NNNN`-style ids (UNVERIFIED any format requirement).
- `free_form_criterion_comments=true` = "use free-form comments" (graders type comments instead of picking ratings). Ratings may still be supplied.
- `ignore_for_scoring`, `mastery_points` and `learning_outcome_identifierref` are optional (outcomes need `learning_outcomes.xml`; out of scope).
- **Attaching to an assignment.** In `assignment_settings.xml` (§6), write `<rubric_identifierref>gRUB1</rubric_identifierref>` plus explicit booleans `<rubric_use_for_grading>`, `<rubric_hide_score_total>`, `<rubric_hide_points>` and `<rubric_hide_outcome_results>`. Each is set only if present (`assignment_importer.rb` L232-251), so write all four. The association purpose is `grading`. `<saved_rubric_comments><comment criterion_id="_1001">text</comment></saved_rubric_comments>` is optional. Rubrics are imported before assignments (`course_content_importer.rb` L134 vs L164).
- If the assignment's `points_possible` is nil and its grading type is points, it inherits the rubric's points (L251).

---

## 6. Assignments
EXP `assignment_resources.rb` L50-134 (CC 1.1 path `add_canvas_assignment`), L193-346 (fields); IMP `assignment_converter.rb` L25-49 + `standard/assignment_converter.rb` L84-233 → `assignment_importer.rb` L107-440.

Manifest:
```xml
<resource identifier="gASSN24" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="gASSN24/problem-set-2.html">
  <file href="gASSN24/problem-set-2.html"/>
  <file href="gASSN24/assignment_settings.xml"/>
</resource>
```
`gASSN24/problem-set-2.html` holds the description. The importer uses the **body** (HTML4 parser `Nokogiri::HTML`, `xml_helper.rb` L101-103). The `<title>` is ignored; Canvas writes `Assignment: <title>`.
```html
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>Assignment: Problem set 2</title>
</head>
<body>
<p>Instructions…</p>
</body>
</html>
```
`gASSN24/assignment_settings.xml` (Canvas field order; scalar fields before any nested blocks):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<assignment identifier="gASSN24" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <title>Problem set 2</title>
  <due_at>2026-09-15T04:59:00</due_at>          <!-- 23:59 CDT -->
  <lock_at>2026-09-18T04:59:00</lock_at>
  <unlock_at>2026-09-08T05:00:00</unlock_at>
  <assignment_group_identifierref>gAG1</assignment_group_identifierref>
  <workflow_state>published</workflow_state>    <!-- published|unpublished -->
  <rubric_identifierref>gRUB1</rubric_identifierref>
  <rubric_use_for_grading>true</rubric_use_for_grading>
  <rubric_hide_points>false</rubric_hide_points>
  <rubric_hide_outcome_results>false</rubric_hide_outcome_results>
  <rubric_hide_score_total>false</rubric_hide_score_total>
  <assignment_overrides/>
  <allowed_extensions>pdf,docx</allowed_extensions>   <!-- empty element if none -->
  <has_group_category>false</has_group_category>
  <points_possible>10.0</points_possible>
  <grading_type>points</grading_type>           <!-- REQUIRED for points to stick (rule 6) -->
  <all_day>false</all_day>
  <submission_types>online_upload,online_text_entry</submission_types>
  <position>1</position>
  <turnitin_enabled>false</turnitin_enabled>
  <vericite_enabled>false</vericite_enabled>
  <peer_review_count>0</peer_review_count>
  <peer_reviews>false</peer_reviews>
  <automatic_peer_reviews>false</automatic_peer_reviews>
  <anonymous_peer_reviews>false</anonymous_peer_reviews>
  <grade_group_students_individually>false</grade_group_students_individually>
  <freeze_on_copy>false</freeze_on_copy>
  <omit_from_final_grade>false</omit_from_final_grade>
  <hide_in_gradebook>false</hide_in_gradebook>
  <intra_group_peer_reviews>false</intra_group_peer_reviews>
  <only_visible_to_overrides>false</only_visible_to_overrides>
  <post_to_sis>false</post_to_sis>
  <moderated_grading>false</moderated_grading>
  <grader_count>0</grader_count>
  <grader_comments_visible_to_graders>true</grader_comments_visible_to_graders>
  <anonymous_grading>false</anonymous_grading>
  <graders_anonymous_to_graders>false</graders_anonymous_to_graders>
  <grader_names_visible_to_final_grader>true</grader_names_visible_to_final_grader>
  <anonymous_instructor_annotations>false</anonymous_instructor_annotations>
  <allowed_attempts>-1</allowed_attempts>      <!-- -1 = unlimited -->
  <post_policy><post_manually>false</post_manually></post_policy>
</assignment>
```
Values and behaviour:
- `grading_type` ∈ `points|percent|letter_grade|gpa_scale|pass_fail|not_graded` (`abstract_assignment.rb` L43, L786).
- `submission_types` (comma list): `online_text_entry`, `online_url`, `online_upload`, `media_recording`, `student_annotation`, `on_paper`, `none`, `external_tool`, `not_graded`. `online_quiz`, `discussion_topic` and `wiki_page` are set by their owning objects; don't use them on standalone assignments.
- `allowed_extensions`: split on commas or whitespace; leading `.` stripped and lowercased (`abstract_assignment.rb` L818-826).
- `workflow_state`: applied on new records (`assignment_importer.rb` L127-132). The default if absent is `published`.
- Peer reviews: `peer_reviews`, `automatic_peer_reviews`, `peer_review_count`, `peer_reviews_due_at` (datetime), `anonymous_peer_reviews`, `intra_group_peer_reviews` (L341-357).
- Turnitin / VeriCite: `turnitin_enabled` applies only if the course has the integration (L374-378). `<turnitin_settings>` is a JSON string.
- `omit_from_final_grade` and `hide_in_gradebook` are honoured (L341-357).
- `moderated_grading` and `anonymous_grading` need course features (L334-339).
- Group assignments: `has_group_category=true` + `group_category` name. The group set is created or matched by name (L325-332).
- `time_zone_edited` is informational only.
- **Description location**: the HTML body becomes `description` after `migration.convert_html` (link rewriting) and the model sanitizer (`abstract_assignment.rb` L793).

Date and time zone handling:
- EXP writes `CCHelper.ims_datetime` → `utc.strftime("%Y-%m-%dT%H:%M:%S")` (`cc_helper.rb` L30, L138-143).
- IMP: `ActiveSupport::TimeZone["UTC"].parse(str)` → epoch ms → `get_utc_time_from_timestamp` (`xml_helper.rb` L25-33; `migrator_helper.rb` L34-50). An explicit offset (`…-05:00`) would be honoured by ActiveSupport parsing, but Canvas never emits one. Emit UTC.
- Empty elements are treated as nil. Canvas emits `<lock_at/>` for none, and the XSD's `optional_dateTime` allows empty.
- Optional "Adjust events and due dates" shifts these on import (§11.3).

---

## 7. Wiki pages
EXP `wiki_resources.rb` L22-83 + `cc_helper.rb` L376-386 (`html_page`); IMP `wiki_converter.rb` L24-92 → `wiki_page_importer.rb` L66-270.

`wiki_content/week-2-overview.html`. The file name (minus `.html`) becomes the page URL slug (`url_name`, `.to_url`, only when blank; L79-82). Parsed with `Nokogiri::HTML5` (`xml_helper.rb` L105-107).
```html
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>Week 2 overview</title>
<meta name="identifier" content="gPAGE21"/>
<meta name="editing_roles" content="teachers"/>
<meta name="workflow_state" content="active"/>
<meta name="front_page" content="true"/>     <!-- only on the one front page -->
</head>
<body>
<p>Body HTML…</p>
<iframe src="https://example.org/embed/abc" title="Simulation" width="800" height="600"
        style="border: 0; max-width: 100%;" allow="fullscreen; clipboard-write" allowfullscreen="allowfullscreen" loading="lazy"></iframe>
</body>
</html>
```
- Meta tags are read generically from `head meta[name]` (`cc_helper.rb` L150-158). EXP omits blank or false values (`next unless v.present?`).
  - `identifier`: **required**, else the page is not saved (`wiki_page_importer.rb` L251).
  - `<title>`: **required** (L235).
  - `workflow_state`: `active` = published; anything else (`unpublished`) = unpublished for new pages (L94-104).
  - `front_page="true"`: becomes the front page only if the course has none yet (L115-117). A front page must be published.
  - `editing_roles`: `teachers` (default for courses), `teachers,students`, … (`wiki_page.rb` L479-500). The full UI value set is UNVERIFIED.
  - Also read: `notify_of_update`, `todo_date`, `publish_at`, `unlock_at`, `lock_at` (time strings, parsed in UTC), `assignment_identifier` (mastery paths only).
- Body = inner HTML of `<body>`, via `to_s` + `gsub(%r{</?body>}, "")` (`cc_helper.rb` L160-164). **Write a bare `<body>`, with no attributes**, or the attributed `<body …>` tag leaks into the content.
- Only page files belong in `wiki_content/`. Every file there is parsed as a page (`wiki_converter.rb` L28-33).
- Manifest (recommended, not read): `<resource identifier="gPAGE21" type="webcontent" href="wiki_content/week-2-overview.html"><file href="wiki_content/week-2-overview.html"/></resource>`.

**Iframes and sanitization** (`canvas_sanitize.rb`). WikiPage `body`, Assignment `description`, Quiz `description`, Course `syllabus_body`, DiscussionTopic `message` and CalendarEvent `description` are all cleaned with `CanvasSanitize::SANITIZE` before save (`wiki_page.rb` L292, `abstract_assignment.rb` L793, `quizzes/quiz.rb` L70, `course.rb` L394, `discussion_topic.rb` L145, `calendar_event.rb` L39).
- `iframe` is an allowed element (L76). Its `src` protocols are `http`, `https` and relative (L655-667). **An `<iframe src="https://…">` survives import.**
- Allowed iframe attributes: `src width height name align frameborder scrolling allow sandbox loading allowfullscreen webkitallowfullscreen mozallowfullscreen` (L251-263), plus global `style class id title role lang dir data-* aria-*` (L198-249). So `allow`, `title`, `width/height` and `style` survive. **Stripped:** `referrerpolicy`, `srcdoc`, `credentialless`, `csp`, `allowpaymentrequest`.
- `style` is filtered per CSS property (L674-750). Allowed properties include `width height max-width min-width max-height min-height border border-* border-radius margin* padding* display position top/left/right float overflow* background* color font font-family font-size font-style text-align vertical-align z-index flex* grid* gap`. **Not allowed (silently removed):** `aspect-ratio`, `font-weight`, `transform`, `opacity`, `box-shadow`, `inset`, `bottom`, `transition`, `object-fit`, CSS variables. Pick iframe sizing that only uses allowed properties, e.g. `width:100%; height:600px; border:0`.
- Elements **not** allowed: `script`, `style`, `link`, `svg`, `form`, `input`, `button`, `label`, `main`, `template`, `dialog`, and custom elements. The element is dropped. Its text is kept, except for `script`/`style`/`svg`, whose contents are dropped too (Sanitize gem default `remove_contents`, UNVERIFIED for the bundled gem version). Allowed elements include `section article aside nav header footer details summary figure figcaption picture time mark` and MathML (L57-190).
- Account-level **Content Security Policy** (Admin → Security) can block iframe domains that aren't on the allowlist at **render** time, even though the HTML imports fine (`app/models/csp/account_helper.rb`, `csp_enabled?`, `csp_domains`). Enforcement details are UNVERIFIED. Ask the target institution whether CSP is on.
- Iframe preservation through the link rewriter (`CanvasImportedHtmlConverter` < `CanvasLinkMigrator::ImportedHtmlConverter`, a closed-source gem `canvas_link_migrator` 1.0.19) is UNVERIFIED for external URLs. Specs show iframe `style`, `title`, `allow` and `allowfullscreen` kept verbatim when only `src` is rewritten (`spec/lib/canvas_imported_html_converter_spec.rb` L214-245).

**Intra-course links** (EXP `cc_helper.rb` L226-336; IMP spec above):
- Page: `$WIKI_REFERENCE$/pages/<page migration id>` (the slug form `$WIKI_REFERENCE$/wiki/<slug>` also resolves)
- Assignment / quiz / discussion: `$CANVAS_OBJECT_REFERENCE$/assignments/<id>`, `…/quizzes/<id>`, `…/discussion_topics/<id>`
- Course pages: `$CANVAS_COURSE_REFERENCE$/modules`
- Files: `$IMS-CC-FILEBASE$/<path under web_resources>` (URL-encode spaces as `%20`)

Tokens may be written raw or `%24`-encoded.

---

## 8. Quizzes (classic) and New Quizzes

### 8.1 Files and manifest (EXP `qti_generator.rb` L82-134)
```xml
<resource identifier="gQUIZ25" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment">
  <file href="gQUIZ25/assessment_qti.xml"/>
  <dependency identifierref="gQUIZ25_meta"/>
</resource>
<resource identifier="gQUIZ25_meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="gQUIZ25/assessment_meta.xml">
  <file href="gQUIZ25/assessment_meta.xml"/>
  <file href="non_cc_assessments/gQUIZ25.xml.qti"/>
</resource>
```
IMP path:
- Canvas runs the external Python QTIMigrationTool over the **whole** `non_cc_assessments/` folder (1.2 → 2.1; `quiz_converter.rb` L39-56; `gems/plugins/qti_exporter/lib/qti.rb` L56-91). Requires `Qti.qti_enabled?` (the `qti_converter` plugin; enabled on hosted Canvas, UNVERIFIED for self-hosted).
- It then merges `<id>/assessment_meta.xml` by matching the **path** `File.join(assessment migration_id, "assessment_meta.xml")` (`quiz_metadata_converter.rb` L24-39). The quiz migration_id comes from `<assessment ident>` (`assessment_test_converter.rb` L123).
- `assessment_qti.xml` (CC profile) is not read by the Canvas importer. Include it only for CC compliance; it may contain just the CC-supported types (`qti_items.rb` L27-39).

### 8.2 `non_cc_assessments/gQUIZ25.xml.qti` (Canvas-flavoured QTI 1.2; EXP `qti_generator.rb` L272-317, `qti_items.rb` L99-566)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
  <assessment ident="gQUIZ25" title="Check-in quiz">
    <qtimetadata>
      <qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
    </qtimetadata>
    <section ident="root_section">

      <!-- Multiple choice -->
      <item ident="gQ1" title="Question 1">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>2.0</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>original_answer_ids</fieldlabel><fieldentry>1001,1002,1003</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;div&gt;&lt;p&gt;Which…?&lt;/p&gt;&lt;/div&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="1001"><material><mattext texttype="text/plain">Alpha</mattext></material></response_label>
              <response_label ident="1002"><material><mattext texttype="text/plain">Beta</mattext></material></response_label>
              <response_label ident="1003"><material><mattext texttype="text/plain">Gamma</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">1002</varequal></conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
      </item>

      <!-- True/false: same shape, exactly two answers whose text is "True"/"False" -->
      <item ident="gQ2" title="Question 2">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>true_false_question</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1.0</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>original_answer_ids</fieldlabel><fieldentry>2001,2002</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;div&gt;&lt;p&gt;The sky is blue.&lt;/p&gt;&lt;/div&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single"><render_choice>
            <response_label ident="2001"><material><mattext texttype="text/plain">True</mattext></material></response_label>
            <response_label ident="2002"><material><mattext texttype="text/plain">False</mattext></material></response_label>
          </render_choice></response_lid>
        </presentation>
        <resprocessing>
          <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
          <respcondition continue="No"><conditionvar><varequal respident="response1">2001</varequal></conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar></respcondition>
        </resprocessing>
      </item>

      <!-- Essay -->
      <item ident="gQ3" title="Question 3">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>essay_question</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>5.0</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>original_answer_ids</fieldlabel><fieldentry></fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;div&gt;&lt;p&gt;Explain…&lt;/p&gt;&lt;/div&gt;</mattext></material>
          <response_str ident="response1" rcardinality="Single"><render_fib><response_label ident="answer1" rshuffle="No"/></render_fib></response_str>
        </presentation>
        <resprocessing>
          <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
          <respcondition continue="No"><conditionvar><other/></conditionvar></respcondition>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>
```
- `question_type` values come from `AssessmentQuestion::ALL_QUESTION_TYPES`: `multiple_choice_question`, `true_false_question`, `multiple_answers_question`, `short_answer_question`, `essay_question`, `matching_question`, `numerical_question`, `fill_in_multiple_blanks_question`, `multiple_dropdowns_question`, `file_upload_question`, `text_only_question`, `calculated_question` (`assessment_item_converter.rb` L219-229).
- Correct answer = the `varequal` whose `setvar SCORE` is `100` → weight 100 (`choice_interaction.rb` L35-45, L89-110). A question with no correct answer gets an `import_error`.
- True/false needs **exactly two** answers whose texts match `/true/` and `/false/`. Otherwise it is downgraded to multiple choice (`choice_interaction.rb` L52-70).
- Answer ids: use **positive integers** (or list them in `original_answer_ids`). Non-numeric idents are replaced with generated ids (`assessment_item_converter.rb` L233-244). The correct-answer mapping with non-numeric idents is UNVERIFIED; integers are safe.
- Question text and answer HTML are XML-**escaped** HTML inside `mattext texttype="text/html"`; Canvas wraps question text in `<div>…</div>`. They are sanitized with the same allowlist (`qti/html_helper.rb` L31-36).
- `item ident` values must be unique across the package. Quiz-question metadata `assessment_question_identifierref` is optional (`assessment_item_converter.rb` L188-190).

### 8.3 `gQUIZ25/assessment_meta.xml` (EXP `qti_generator.rb` L211-270; IMP `quiz_metadata_converter.rb` L41-104 → `quiz_importer.rb` L171-340)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="gQUIZ25" xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <title>Check-in quiz</title>                    <!-- quiz scalars BEFORE nested <assignment> -->
  <description>&lt;p&gt;Instructions&lt;/p&gt;</description>
  <due_at>2026-09-15T04:59:00</due_at>
  <lock_at>2026-09-18T04:59:00</lock_at>
  <unlock_at>2026-09-08T05:00:00</unlock_at>
  <shuffle_answers>false</shuffle_answers>
  <scoring_policy>keep_highest</scoring_policy>   <!-- keep_highest|keep_latest|keep_average -->
  <hide_results></hide_results>                   <!-- ""|always|until_after_last_attempt -->
  <quiz_type>assignment</quiz_type>               <!-- assignment|practice_quiz|graded_survey|survey -->
  <points_possible>8.0</points_possible>
  <require_lockdown_browser>false</require_lockdown_browser>
  <show_correct_answers>true</show_correct_answers>
  <anonymous_submissions>false</anonymous_submissions>
  <could_be_locked>false</could_be_locked>
  <time_limit>20</time_limit>                     <!-- minutes; omit for none -->
  <allowed_attempts>2</allowed_attempts>          <!-- -1 = unlimited -->
  <one_question_at_a_time>false</one_question_at_a_time>
  <cant_go_back>false</cant_go_back>
  <available>true</available>                     <!-- true = published -->
  <one_time_results>false</one_time_results>
  <show_correct_answers_last_attempt>false</show_correct_answers_last_attempt>
  <only_visible_to_overrides>false</only_visible_to_overrides>
  <module_locked>false</module_locked>
  <assignment identifier="gQUIZ25_asg">           <!-- REQUIRED for graded quizzes (rule 7) -->
    <title>Check-in quiz</title>
    <due_at>2026-09-15T04:59:00</due_at>
    <lock_at>2026-09-18T04:59:00</lock_at>
    <unlock_at>2026-09-08T05:00:00</unlock_at>
    <assignment_group_identifierref>gAG2</assignment_group_identifierref>
    <workflow_state>published</workflow_state>
    <quiz_identifierref>gQUIZ25</quiz_identifierref>
    <points_possible>8.0</points_possible>
    <grading_type>points</grading_type>
    <submission_types>online_quiz</submission_types>
    <omit_from_final_grade>false</omit_from_final_grade>
  </assignment>
  <assignment_group_identifierref>gAG2</assignment_group_identifierref>
  <assignment_overrides/>
</quiz>
```
- Nested `<assignment>` is parsed with the same assignment parser (§6). Its migration id is its `identifier` attribute (`standard/assignment_converter.rb` L90).
- Without it, a graded Canvas-package quiz gets **no** assignment and is forced unpublished (`quiz_importer.rb` L301-303, L327-329). `practice_quiz` and `survey` don't need it.
- `available=true` publishes the quiz (L314-317).
- `assignment_group_identifierref` at the quiz level is also honoured (L322-325).

### 8.4 New Quizzes on import
- **Yes, there is a convert-on-import option.** The Canvas Course Export Package form passes `canImportAsNewQuizzes={ENV.NEW_QUIZZES_MIGRATION}` (`ui/features/content_migrations/react/components/migrator_forms/canvas_cartridge.tsx`). This renders the checkbox **"Import existing quizzes as New Quizzes"**, or "Convert content to New Quizzes" when `new_quizzes_unattached_bank_migrations` is on. It submits `settings.import_quizzes_next` (`ui/shared/content-migrations/react/CommonMigratorControls/CommonMigratorControls.tsx` L62-68, L148-150, L200, L219-232; legacy `ui/shared/content-migrations/jst/ImportQuizzesNextView.handlebars`).
- **When it shows:** `new_quizzes_migration_enabled?` = root account `feature_allowed?(:quizzes_next)` && `feature_enabled?(:new_quizzes_migration)` (`app/helpers/new_quizzes_features_helper.rb`; ENV set in `content_migrations_controller.rb` L159-164).
  - It is pre-checked if `migrate_to_new_quizzes_by_default` or `require_migration_to_new_quizzes` is on.
  - It is disabled if the course lacks New Quizzes (`QUIZZES_NEXT_ENABLED` = course `quizzes_next` + quiz LTI tool) or if migration is required.
- **Effect:** `quizzes_next_migration?` = course `quizzes_next` enabled && `import_quizzes_next` true (`content_migration.rb` L712-720). The import then runs `QuizzesNext::Importers::CourseContentImporter` (`content_migration.rb` L690-733; `app/models/quizzes_next/importers/course_content_importer.rb`). That importer:
  1. Does the normal import.
  2. Turns each imported classic quiz's assignment into a `quiz_lti` (New Quizzes) assignment. Graded quizzes and surveys use the quiz's assignment; practice quizzes get a 0-point, `omit_from_final_grade` assignment.
  3. Moves module items onto that assignment and destroys the classic quiz.
  4. Records `lti_assignment_quiz_set` for the New Quizzes service to build the quiz content.
  
  The content conversion runs in the closed New Quizzes service (UNVERIFIED which question types and settings survive; MC/TF/essay are core types and are expected to convert).
- **API:** `POST /api/v1/courses/:id/content_migrations` with `migration_type=canvas_cartridge_importer`, `settings[import_quizzes_next]=true`. Arbitrary `settings[...]` keys are copied into `migration_settings` (`content_migrations_controller.rb` L624; `content_migration.rb` L147-151).
- A separate site-admin path, `common_cartridge_qti_new_quizzes_import`, also converts quizzes in CC/Canvas packages. It applies to quizzes whose QTI `<assessment>` carries `external_assignment_id` (i.e. packages exported *from* New Quizzes) (`qti.rb` L72-86; `quiz_importer.rb` L258-267; `content_migration.rb` L706-710). Don't depend on it for generated packages.
- Community docs confirming the user-facing option (page bodies not machine-readable here): [How do I migrate a Canvas quiz to New Quizzes?](https://community.instructure.com/en/kb/articles/661049-how-do-i-migrate-a-canvas-quiz-to-new-quizzes), [Course Import tool](https://community.instructure.com/en/kb/articles/660727-how-do-i-copy-content-from-another-canvas-course-using-the-course-import-tool), [New Quizzes Migration through Course Copy/Import](https://community.canvaslms.com/t5/The-Product-Blog/New-Quizzes-Migration-through-Course-Copy-Import-in-Production/ba-p/576786).

---

## 9. External URLs and syllabus

**ExternalUrl module items.** They need only the module_meta `<item>` with `<content_type>ExternalUrl</content_type>`, `<url>`, `<title>`, `<new_tab>` and `<workflow_state>active</workflow_state>` (§3). For CC compliance also write the web link resource and point the organization item's `identifierref` at it (`web_links.rb` L22-46; `organization.rb` L67-75); Canvas ignores both.
```xml
<!-- gWEBLINK23.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<webLink xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imswl_v1p1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imswl_v1p1 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imswl_v1p1.xsd">
  <title>Live session (Zoom)</title>
  <url href="https://example.zoom.us/j/123"/>
</webLink>
<!-- manifest -->
<resource identifier="gWEBLINK23" type="imswl_xmlv1p1"><file href="gWEBLINK23.xml"/></resource>
```
**Syllabus.** `course_settings/syllabus.html`, in the same `html_page` shape as a wiki page (title "Syllabus", no meta needed) (`canvas_resource.rb` L140-152).
- IMP takes the body (`course_settings.rb` L43-45, L169-171). It is parsed with the **HTML4** parser (`open_file`) and saved via `convert_html` + sanitizer (`course_content_importer.rb` L480-489).
- It is imported if "All content", or if "Syllabus Body" is ticked (L206-210).
- `<syllabus_course_summary>` and `<public_syllabus>` live in course_settings.xml.
- Declare it with the LOR resource in §1.4 (`intendeduse="syllabus"`).

---

## 10. Recognition requirements and pitfalls (consolidated)

**Recognition** (`package_identifier.rb` L52-68):
- `imsmanifest.xml` at the root, or under a single top folder.
- `<metadata><schema>IMS Common Cartridge</schema>`.
- Either a resource with `href="course_settings/canvas_export.txt"`, **or** a resource `href="course_settings/syllabus.html"` containing `<file href="course_settings/course_settings.xml">`.

Otherwise the package becomes `common_cartridge_1_x` and the Standard converter ignores all `course_settings/` extensions. The UI choice ("Canvas Course Export Package") does not force the converter; nothing sets `converter_class` (`cc_worker.rb` L43-52).

**Pitfalls:**
- *Ordering:* see rule 3. Specifically:
  - module `title/workflow_state/position` before `prerequisites/items`
  - criterion `criterion_id/points/description` before `ratings`
  - quiz scalars before the nested `<assignment>`
  - topic meta scalars before the nested `<assignment>`
- *Missing files:*
  - Every `<file>` the importer opens must exist: assignment `.html` + settings, quiz meta, topic xml + meta.
  - An assignment LOR resource without an `.html` file entry crashes the import (`assignment_converter.rb` L32).
- *Escaping:*
  - The XML files are real XML: escape `&` `<` `>` in titles. HTML stored in XML (`<description>`, `<mattext texttype="text/html">`, event descriptions) must be **escaped text** (`&lt;p&gt;`), as Builder does.
  - HTML named entities such as `&nbsp;` are **invalid in XML** unless escaped (`&amp;nbsp;`) or written as numeric (`&#160;`). Nokogiri parses in recover mode, so a bad entity silently corrupts data instead of failing (UNVERIFIED exact loss behaviour).
  - The `.html` files are parsed as HTML, so entities are fine there.
  - Use UTF-8 throughout.
- *Booleans:* the regex is a substring match (`xml_helper.rb` L62-64). Only emit `true`/`false`.
- *Selective import:* with "Select specific content", course settings, syllabus, events and so on import only if ticked. Module selection auto-selects linked items (`context_module_importer.rb` L43-68).
- *Quizzes re-import:* duplicates (§1.5).
- *Module item title:* for content-backed items, the content's title wins.
- *Front page:* front_page is ignored if the course already has one. `default_view=wiki` needs a published front page.
- *Points:* assignments need `grading_type`; rubrics need `points_possible`; quiz points come from the meta and the questions. Keep quiz `points_possible` = the sum of item `points_possible`.
- *Files:* only `web_resources/` resources declared in the manifest are uploaded. Link to them with `$IMS-CC-FILEBASE$/…`.

---

## 11. Calendar events (`course_settings/events.xml`)

### 11.1 Format
EXP `lib/cc/events.rb` L22-65 (only `calendar_events.active.user_created`); IMP `course_settings.rb` L266-287 → `app/models/importers/calendar_event_importer.rb` L25-80; XSD L902-924.
```xml
<?xml version="1.0" encoding="UTF-8"?>
<events xmlns="http://canvas.instructure.com/xsd/cccv1p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://canvas.instructure.com/xsd/cccv1p0 https://canvas.instructure.com/xsd/cccv1p0.xsd">
  <event identifier="gEVT1">
    <title>Live session — Week 2</title>
    <description>&lt;p&gt;Join on Zoom: &lt;a href="https://example.zoom.us/j/123"&gt;https://example.zoom.us/j/123&lt;/a&gt;&lt;/p&gt;&lt;p&gt;Location: Room 101, Main Hall&lt;/p&gt;</description>
    <start_at>2026-09-09T23:00:00</start_at>     <!-- 18:00 CDT, UTC -->
    <end_at>2026-09-10T00:30:00</end_at>
  </event>
  <event identifier="gEVT2">
    <title>Reading day</title>
    <description></description>
    <start_at>2026-09-14T05:00:00</start_at>
    <end_at>2026-09-14T05:00:00</end_at>
    <all_day>true</all_day>
    <all_day_date>2026-09-14</all_day_date>      <!-- YYYY-MM-DD -->
  </event>
</events>
```
- **Fields Canvas reads:**
  - `title`
  - `description` (HTML, escaped in XML)
  - `start_at`, `end_at` (UTC datetime)
  - `all_day` (bool), `all_day_date` (date)
  - `rrule`, `series_uuid`, `series_head`
  - `blackout_date` (bool; course-pacing blackout)
  
  The `identifier` attribute is the migration id.
- **Not supported:**
  - `location_name` / `location_address`: not exported, not in the XSD, not read by the importer (grep of `lib/cc` and `app/models/importers` finds nothing), although the model has the columns (`calendar_event.rb`). Put the location in the description.
  - `workflow_state`: also not exported or read. New events are active; a previously deleted event with the same migration id is reactivated (`calendar_event_importer.rb` L54).
- **Recurring series:** Canvas exports each occurrence as its own `<event>` sharing `series_uuid`, with one `series_head`. The importer only remaps `series_uuid` to a fresh UUID per series (L31-34) and copies `rrule`; it does **not** expand `rrule` into occurrences (no expansion code in the importer). So write every occurrence explicitly. rrule/series are optional.
- **https links in the description:** yes. The description goes through `migration.convert_html` (L57) and the model sanitizer (`calendar_event.rb` L39). `a[href]` allows `http https mailto tel ftp` + relative (`canvas_sanitize.rb` L655-660), so a Zoom URL survives. `target="_blank"` is allowed on `<a>`.
- **Import gating:** the "Calendar Events" selective-import checkbox, or "All content" (`import_object?("calendar_events")`, L29). Canvas also lists `course_settings/events.xml` in the course_settings resource (§1.4). The importer reads it by fixed path regardless (`course_settings.rb` L55).
- Events are matched by migration_id on re-import, so they update in place (L48-49).

### 11.2 Module unlocks, sequencing and requirements (confirmation)
In `module_meta.xml` (§3), exactly as `module_meta.rb` L44-46, L103-116 writes them:
- `<unlock_at>YYYY-MM-DDTHH:MM:SS</unlock_at>` (UTC; written only when set).
- `<require_sequential_progress>true|false</require_sequential_progress>` (written whenever non-nil).
- `<completionRequirements><completionRequirement type="must_view|must_submit|must_mark_done|must_contribute|min_score|min_percentage"><min_score>…</min_score>?<identifierref>MODULE_ITEM_IDENTIFIER</identifierref></completionRequirement>…</completionRequirements>`

The importer reads these in `module_converter.rb` L36-37 and L59-68 and applies them in `context_module_importer.rb` L142-147 and L183-196. Validation restricts `must_submit`/`min_*` to scoreable items (`context_module.rb` L578-588).

### 11.3 Date shifting ("Adjust events and due dates")
Code: `content_migration.rb` L1052-1056 (options `shift_dates`, `remove_dates`, `old_start_date`, `old_end_date`, `new_start_date`, `new_end_date`, `day_substitutions`, `time_zone`); `course_content_importer.rb` L349-456 (`adjust_dates`) and L666-751 (`shift_date_options`, `shift_date`).
- **Shifted objects:** calendar events (`start_at`, `end_at`, `all_day_date`; L393-402), modules (`unlock_at`), assignments, quizzes, overrides, discussions/announcements, files/folders, and pages (`todo_date`, `publish_at`, `lock_at`, `unlock_at`). Assignment and quiz dates may instead be shifted at save time when the `pre_date_shift_for_assignment_importing` flag is on (L354, L404); the result is the same.
- **Algorithm (`shift_date`):**
  - Each date's **calendar day** is mapped proportionally from [old_start, old_end] onto [new_start, new_end].
  - It is then moved to the substituted weekday (default: the same weekday).
  - The **wall-clock hour:minute is kept** in `time_zone` (the option, else the target root account's default zone).
  - If any of old/new start/end is missing, the date is left unchanged. When old dates aren't given, they default to the **target** course's dates, not the package's `start_at` (L670-675).
  - A missing `new_end_date` is inferred to preserve the course length (L681-685).
- **"Remove dates"** (`remove_dates`) sets every shifted date to nil (L721-722), including event `start_at`/`end_at`. Don't offer it for event-heavy packages.
- **Practical upshot:** generate absolute dates for a reference term. Instructors re-target them with "Adjust events and due dates" by entering the original term's start/end and the new term's start/end. Weekly live sessions keep their local time and weekday.

---

## Appendix: minimal end-to-end checklist
1. `imsmanifest.xml` with: the schema + `canvas_export.txt` resource (§1.4), plus syllabus, page, assignment, quiz, file and weblink resources.
2. `course_settings/`:
   - `canvas_export.txt`
   - `course_settings.xml` (default_view, group_weighting_scheme, time_zone)
   - `module_meta.xml`
   - `assignment_groups.xml`
   - `rubrics.xml`
   - `events.xml`
   - `syllabus.html`
3. `wiki_content/<slug>.html`, each with an identifier meta, `<title>`, `workflow_state` and a bare `<body>`.
4. Per assignment: `<id>/<slug>.html` + `<id>/assignment_settings.xml` (with `grading_type`, group ref, rubric refs).
5. Per quiz:
   - `non_cc_assessments/<id>.xml.qti` (ident = `<id>`)
   - `<id>/assessment_meta.xml`, with a nested `<assignment>` if graded
   - (optional) `<id>/assessment_qti.xml`
6. Deterministic ids. Zip with `imsmanifest.xml` at the root and name it `*.imscc`.
