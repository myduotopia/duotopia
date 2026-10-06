import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import TeacherClassrooms from "../TeacherClassrooms";

// Mock workspace context
const mockWorkspace: {
  mode: string;
  selectedSchool: { id: string; name: string } | null;
  selectedOrganization: { id: string; name: string } | null;
  setMode: ReturnType<typeof vi.fn>;
  setSelectedSchool: ReturnType<typeof vi.fn>;
  setSelectedOrganization: ReturnType<typeof vi.fn>;
  organizations: { id: string; name: string }[];
  schools: { id: string; name: string }[];
  loading: boolean;
} = {
  mode: "personal",
  selectedSchool: null,
  selectedOrganization: null,
  setMode: vi.fn(),
  setSelectedSchool: vi.fn(),
  setSelectedOrganization: vi.fn(),
  organizations: [],
  schools: [],
  loading: false,
};

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => mockWorkspace,
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "teacherClassrooms.title": "My Classrooms",
        "teacherClassrooms.buttons.reload": "Reload",
        "teacherClassrooms.buttons.addClassroom": "Add Classroom",
        "teacherClassrooms.buttons.add": "Add",
        "teacherClassrooms.buttons.dispatchAssignment": "Assign Homework",
        "teacherClassrooms.buttons.confirmDelete": "Confirm Delete",
        "teacherClassrooms.buttons.create": "Create",
        "teacherClassrooms.buttons.createFirst": "Create First Classroom",
        "teacherClassrooms.stats.totalClassrooms": "Total Classrooms",
        "teacherClassrooms.stats.totalStudents": "Total Students",
        "teacherClassrooms.stats.activeClassrooms": "Active Classrooms",
        "teacherClassrooms.labels.classroomName": "Classroom Name",
        "teacherClassrooms.labels.description": "Description",
        "teacherClassrooms.labels.level": "Level",
        "teacherClassrooms.labels.students": "Students",
        "teacherClassrooms.labels.programs": "Programs",
        "teacherClassrooms.labels.studentCount": "Student Count",
        "teacherClassrooms.labels.programCount": "Program Count",
        "teacherClassrooms.labels.createdAt": "Created At",
        "teacherClassrooms.labels.actions": "Actions",
        "teacherClassrooms.labels.school": "School",
        "teacherClassrooms.messages.noDescription": "No description",
        "teacherClassrooms.messages.noClassrooms": "No classrooms yet",
        "teacherClassrooms.messages.createFirstDescription":
          "Create your first classroom",
        "teacherClassrooms.placeholders.searchName": "Search classroom name...",
        "teacherClassrooms.filters.allLevels": "All Levels",
        "teacherClassrooms.sort.default": "Default",
        "teacherClassrooms.sort.nameAsc": "Name A→Z",
        "teacherClassrooms.sort.nameDesc": "Name Z→A",
        "teacherClassrooms.sort.studentCountDesc": "Most Students",
        "teacherClassrooms.sort.createdAtDesc": "Newest First",
        "teacherClassrooms.sort.createdAtAsc": "Oldest First",
        "teacherClassrooms.dialogs.editTitle": "Edit Classroom",
        "teacherClassrooms.dialogs.editDescription": "Modify classroom info",
        "teacherClassrooms.dialogs.deleteTitle": "Confirm Delete Classroom",
        "teacherClassrooms.dialogs.deleteDescription":
          "Are you sure you want to delete?",
        "teacherClassrooms.dialogs.createTitle": "Add Classroom",
        "teacherClassrooms.dialogs.createDescription": "Create a new classroom",
        "teacherClassrooms.placeholders.classroomName": "e.g., Grade 5",
        "teacherClassrooms.placeholders.description": "Description",
        "teacherClassrooms.oneCampusSync.buttonIdle": "Sync 1Campus",
        "teacherClassrooms.oneCampusSync.buttonSyncing": "Syncing...",
        "teacherClassrooms.oneCampusSync.tooltip": "Sync 1Campus tooltip",
        "teacherClassrooms.oneCampusSync.confirm.title":
          "Sync into your personal account?",
        "teacherClassrooms.oneCampusSync.confirm.message":
          "Points will be deducted from your personal balance.",
        "teacherClassrooms.oneCampusSync.confirm.confirmButton": "Sync anyway",
        "common.loading": "Loading...",
        "common.edit": "Edit",
        "common.delete": "Delete",
        "common.cancel": "Cancel",
        "common.save": "Save",
        "dialogs.createProgramDialog.custom.levels.A1": "A1",
        "dialogs.createProgramDialog.custom.levels.A2": "A2",
        "dialogs.createProgramDialog.custom.levels.B1": "B1",
        "dialogs.createProgramDialog.custom.levels.B2": "B2",
        "dialogs.createProgramDialog.custom.levels.C1": "C1",
        "dialogs.createProgramDialog.custom.levels.C2": "C2",
        // #1097 classroom grade
        "teacherClassrooms.labels.grade": "Grade",
        "classroomGrade.gradeLabel": "Grade {{grade}}",
        "classroomGrade.unset": "Not set",
        "classroomGrade.selectPlaceholder": "Select a grade",
        "classroomGrade.required": "Please select a grade",
        "classroomGrade.filter.label": "Filter by grade",
        "classroomGrade.filter.all": "All Grades",
        "classroomGrade.filter.unset": "Grade not set",
        "classroomGrade.selection.selectedCount":
          "{{count}} classroom(s) selected",
        "classroomGrade.selection.selectAll": "Select all listed classrooms",
        "classroomGrade.selection.selectRow": "Select {{name}}",
        "classroomGrade.selection.clear": "Clear selection",
        "classroomGrade.banner.message":
          "{{count}} classroom(s) have no grade set",
        "classroomGrade.banner.action": "Set now",
        "classroomGrade.adjust.button": "Adjust grade",
        "classroomGrade.adjust.title": "Adjust grade dialog",
        "classroomGrade.adjust.description": "Choose a direction",
        "classroomGrade.adjust.up": "Up one grade",
        "classroomGrade.adjust.down": "Down one grade",
        "classroomGrade.adjust.changesTitle":
          "{{count}} classroom(s) will change",
        "classroomGrade.adjust.skippedTitle": "{{count}} classroom(s) skipped",
        "classroomGrade.adjust.nothingToChange":
          "No classrooms can be adjusted",
        "classroomGrade.adjust.reason.max": "Already Grade {{grade}}",
        "classroomGrade.adjust.reason.min": "Already Grade {{grade}}",
        "classroomGrade.adjust.reason.unset": "Grade not set",
        "classroomGrade.adjust.confirm": "Apply ({{count}})",
        "classroomGrade.missingDialog.title": "Set classroom grades",
        "classroomGrade.missingDialog.description": "Choose a grade",
        "classroomGrade.missingDialog.rowLabel": "Grade for {{name}}",
        "classroomGrade.missingDialog.save": "Save ({{count}})",
        "classroomGrade.limitExceeded": "Up to {{max}} classrooms at a time",
        "classroomGrade.messages.saveSuccess": "Updated {{count}} classroom(s)",
        "classroomGrade.messages.saveFailed": "Failed to update grades",
        "classroomGrade.messages.reloadFailed":
          "Saved, but the list could not be reloaded",
        "teacherClassrooms.messages.nameRequired": "Please enter a name",
        "teacherClassrooms.messages.updateFailed": "Failed to update",
        "classroomGrade.status.column": "Status",
        "classroomGrade.status.active": "Active",
        "classroomGrade.status.inactive": "Inactive",
        "classroomGrade.status.toggle": "Toggle {{name}}",
        "classroomGrade.status.filterLabel": "Filter by status",
        "classroomGrade.status.filterAll": "All statuses",
        "classroomGrade.status.activated": "Activated {{name}}",
        "classroomGrade.status.deactivated": "Deactivated {{name}}",
        "classroomGrade.status.dispatchDisabled": "Classroom inactive",
        "classroomGrade.inline.unsavedConfirm":
          "You have unsaved changes. Discard them?",
        "classroomGrade.inline.saveSuccess": "Updated {{name}}",
        "classroomGrade.level.button": "Adjust level",
        "classroomGrade.level.title": "Adjust level dialog",
        "classroomGrade.level.targetLabel": "Target level",
        "classroomGrade.level.targetPlaceholder": "Select a level",
        "classroomGrade.level.changesTitle":
          "{{count}} classroom(s) will change",
        "classroomGrade.level.skippedTitle": "{{count}} classroom(s) skipped",
        "classroomGrade.level.alreadyAtTarget": "Already {{level}}",
        "classroomGrade.level.confirm": "Apply ({{count}})",
        "classroomGrade.level.saveSuccess": "Updated {{count}} level(s)",
        "classroomGrade.bulk.deactivate": "Deactivate",
        "classroomGrade.bulk.activate": "Activate",
        "classroomGrade.bulk.deactivateTitle":
          "Deactivate {{count}} classroom(s)?",
        "classroomGrade.bulk.deactivateDescription":
          "Students will no longer see these classrooms",
        "classroomGrade.bulk.deactivated": "Deactivated {{count}}",
        "classroomGrade.sort.gradeAsc": "Grade low to high",
        "classroomGrade.sort.gradeDesc": "Grade high to low",
        "classroomGrade.sort.levelAsc": "Level low to high",
        "classroomGrade.sort.levelDesc": "Level high to low",
        "classroomGrade.sort.studentCountAsc": "Fewest Students",
      };
      if (key === "teacherClassrooms.messages.totalCount" && opts) {
        return `Total ${opts.count} classrooms`;
      }
      const template = translations[key];
      if (!template) return key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(opts?.[name] ?? ""),
      );
    },
    i18n: { language: "en" },
  }),
}));

// Mock AssignmentDialog
const mockAssignmentDialog = vi.fn();
vi.mock("@/components/AssignmentDialog", () => ({
  AssignmentDialog: (props: Record<string, unknown>) => {
    mockAssignmentDialog(props);
    return props.open ? (
      <div data-testid="assignment-dialog">AssignmentDialog</div>
    ) : null;
  },
}));

// Mock API
const mockGetTeacherClassrooms = vi.fn();
const mockSyncOneCampusClasses = vi.fn();
const mockCreateClassroom = vi.fn();
const mockBatchSetClassroomGrades = vi.fn();
const mockUpdateClassroom = vi.fn();
const mockBatchUpdateClassrooms = vi.fn();
vi.mock("@/lib/api", () => ({
  apiClient: {
    getTeacherClassrooms: (...args: unknown[]) =>
      mockGetTeacherClassrooms(...args),
    syncOneCampusClasses: (...args: unknown[]) =>
      mockSyncOneCampusClasses(...args),
    createClassroom: (...args: unknown[]) => mockCreateClassroom(...args),
    updateClassroom: (...args: unknown[]) => mockUpdateClassroom(...args),
    batchUpdateClassrooms: (...args: unknown[]) =>
      mockBatchUpdateClassrooms(...args),
    deleteClassroom: vi.fn(),
    batchSetClassroomGrades: (...args: unknown[]) =>
      mockBatchSetClassroomGrades(...args),
  },
  ApiError: class ApiError extends Error {
    status?: number;
  },
}));

// GradeBulkBar reads the sidebar width for its left offset
vi.mock("@/contexts/SidebarContext", () => ({
  useSidebar: () => ({ sidebarWidth: 0 }),
}));

// Mock toast (sonner) so toasts can be asserted
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const mockClassrooms = [
  {
    id: 1,
    name: "Alpha Class",
    description: "First class",
    level: "A1",
    grade: 3,
    student_count: 5,
    students: [
      { id: 1, name: "Student A", email: "a@test.com" },
      { id: 2, name: "Student B", email: "b@test.com" },
    ],
    program_count: 3,
    created_at: "2026-01-15T00:00:00Z",
  },
  {
    id: 2,
    name: "Beta Class",
    description: "Second class",
    level: "B1",
    grade: 5,
    student_count: 10,
    students: [{ id: 3, name: "Student C", email: "c@test.com" }],
    program_count: 1,
    created_at: "2026-02-20T00:00:00Z",
  },
  {
    id: 3,
    name: "Charlie Class",
    description: "",
    level: "A1",
    grade: null,
    student_count: 0,
    students: [],
    program_count: 0,
    created_at: "2026-01-01T00:00:00Z",
  },
];

function renderComponent() {
  return render(
    <BrowserRouter>
      <TeacherClassrooms />
    </BrowserRouter>,
  );
}

describe("TeacherClassrooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTeacherClassrooms.mockResolvedValue(mockClassrooms);
    mockSyncOneCampusClasses.mockResolvedValue({
      synced: false,
      schools: [],
    });
    mockWorkspace.mode = "personal";
    mockWorkspace.selectedSchool = null;
    mockWorkspace.selectedOrganization = null;
    mockWorkspace.organizations = [];
  });

  // Vitest 3: restores vi.spyOn spies only (module-level vi.fn mocks are untouched)
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Rendering", () => {
    it("should render the page title and classrooms", async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText("My Classrooms")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Beta Class").length).toBeGreaterThan(0);
      });
    });

    it("should render search input and level filter", async () => {
      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Search classroom name..."),
        ).toBeInTheDocument();
      });

      // Level filter select should have "All Levels" option
      const selects = screen.getAllByRole("combobox");
      const levelSelect = selects.find((s) =>
        Array.from(s.querySelectorAll("option")).some(
          (o) => o.textContent === "All Levels",
        ),
      );
      expect(levelSelect).toBeDefined();
    });
  });

  describe("Search", () => {
    it("should filter classrooms by name when typing in search", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const searchInput = screen.getByPlaceholderText(
        "Search classroom name...",
      );
      await user.type(searchInput, "Beta");

      await waitFor(() => {
        expect(screen.getAllByText("Beta Class").length).toBeGreaterThan(0);
        expect(screen.queryByText("Alpha Class")).not.toBeInTheDocument();
      });
    });

    it("should show no results when search matches nothing", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const searchInput = screen.getByPlaceholderText(
        "Search classroom name...",
      );
      await user.type(searchInput, "NonExistent");

      await waitFor(() => {
        expect(screen.queryByText("Alpha Class")).not.toBeInTheDocument();
        expect(screen.queryByText("Beta Class")).not.toBeInTheDocument();
        // Both mobile and desktop show total count
        expect(
          screen.getAllByText("Total 0 classrooms").length,
        ).toBeGreaterThan(0);
      });
    });
  });

  describe("Level Filter", () => {
    it("should filter classrooms by level", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      // Find the level filter (select with "All Levels" option)
      const selects = screen.getAllByRole("combobox");
      const levelSelect = selects.find((s) =>
        Array.from(s.querySelectorAll("option")).some(
          (o) => o.textContent === "All Levels",
        ),
      );
      expect(levelSelect).toBeDefined();

      await user.selectOptions(levelSelect!, "B1");

      await waitFor(() => {
        expect(screen.getAllByText("Beta Class").length).toBeGreaterThan(0);
        expect(screen.queryByText("Alpha Class")).not.toBeInTheDocument();
      });
    });
  });

  describe("Sorting (Desktop)", () => {
    it("should sort by name ascending when clicking name header", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      // Find the sortable name header button
      const nameHeader = screen.getByRole("button", {
        name: /Classroom Name/i,
      });
      await user.click(nameHeader);

      // After sorting by name asc, Alpha should come before Beta
      const rows = screen.getAllByRole("row");
      const textContent = rows.map((r) => r.textContent).join(" ");
      const alphaIndex = textContent.indexOf("Alpha Class");
      const betaIndex = textContent.indexOf("Beta Class");
      expect(alphaIndex).toBeLessThan(betaIndex);
    });

    it("should toggle sort direction on second click", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const nameHeader = screen.getByRole("button", {
        name: /Classroom Name/i,
      });

      // First click: asc
      await user.click(nameHeader);

      // Wait for asc sort to take effect
      await waitFor(() => {
        const table = screen.getByRole("table");
        const links = table.querySelectorAll("tbody a");
        const names = Array.from(links).map((a) => a.textContent);
        expect(names[0]).toBe("Alpha Class");
      });

      // Re-query the button (it may have been re-rendered)
      const nameHeaderAgain = screen.getByRole("button", {
        name: /Classroom Name/i,
      });
      // Second click: desc
      await user.click(nameHeaderAgain);

      // Get only the desktop table rows and extract classroom names in order
      await waitFor(() => {
        const table = screen.getByRole("table");
        const links = table.querySelectorAll("tbody a");
        const names = Array.from(links).map((a) => a.textContent);
        // In desc order: Charlie > Beta > Alpha
        expect(names).toEqual(["Charlie Class", "Beta Class", "Alpha Class"]);
      });
    });
  });

  describe("Expandable Rows", () => {
    it("should expand row details on click", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      // Find the desktop table rows (hidden on mobile but present in DOM)
      // Click on the first data row in the table
      const rows = screen.getAllByRole("row");
      // rows[0] is the header, rows[1] is the first data row
      const firstDataRow = rows.find(
        (r) =>
          r.textContent?.includes("Alpha Class") &&
          !r.textContent?.includes("Classroom Name"),
      );

      if (firstDataRow) {
        await user.click(firstDataRow);

        // Expanded row should show more details
        await waitFor(() => {
          // Check for expanded detail content - description label appears in expanded row
          const descriptions = screen.getAllByText("Description");
          expect(descriptions.length).toBeGreaterThan(0);
        });
      }
    });
  });

  describe("Dispatch Assignment Button", () => {
    it("should be disabled when classroom has 0 students", async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Charlie Class").length).toBeGreaterThan(0);
      });

      // Charlie Class has 0 students, so its dispatch button should be disabled
      const dispatchButtons = screen.getAllByTitle("Assign Homework");
      // Find the one in Charlie Class's row
      const charlieDispatch = dispatchButtons.find((btn) => {
        const row = btn.closest("tr");
        return row?.textContent?.includes("Charlie Class");
      });

      expect(charlieDispatch).toBeDefined();
      if (charlieDispatch) {
        expect(charlieDispatch).toBeDisabled();
      }
    });

    it("should be enabled when classroom has students", async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const dispatchButtons = screen.getAllByTitle("Assign Homework");
      const alphaDispatch = dispatchButtons.find((btn) => {
        const row = btn.closest("tr");
        return row?.textContent?.includes("Alpha Class");
      });

      expect(alphaDispatch).toBeDefined();
      if (alphaDispatch) {
        expect(alphaDispatch).not.toBeDisabled();
      }
    });

    it("should open AssignmentDialog when clicked", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const dispatchButtons = screen.getAllByTitle("Assign Homework");
      const alphaDispatch = dispatchButtons.find((btn) => {
        const row = btn.closest("tr");
        return row?.textContent?.includes("Alpha Class");
      });

      expect(alphaDispatch).toBeDefined();
      await user.click(alphaDispatch!);

      await waitFor(() => {
        expect(screen.getByTestId("assignment-dialog")).toBeInTheDocument();
      });

      // Verify AssignmentDialog was called with correct props
      expect(mockAssignmentDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          open: true,
          classroomId: 1,
          students: mockClassrooms[0].students,
        }),
      );
    });
  });

  describe("Organization Mode", () => {
    it("should disable edit/delete but keep dispatch enabled in org mode", async () => {
      mockWorkspace.mode = "organization";
      mockWorkspace.selectedOrganization = {
        id: "org-1",
        name: "Test Org",
      };

      // Return classrooms with organization_id
      mockGetTeacherClassrooms.mockResolvedValue([
        {
          ...mockClassrooms[0],
          organization_id: "org-1",
        },
      ]);

      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      // Edit buttons should be disabled
      const editButtons = screen.getAllByTitle("Edit");
      editButtons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });

      // Delete buttons should be disabled
      const deleteButtons = screen.getAllByTitle("Delete");
      deleteButtons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });

      // Dispatch assignment button should still be enabled
      const dispatchButtons = screen.getAllByTitle("Assign Homework");
      const enabledDispatch = dispatchButtons.find(
        (btn) => !btn.hasAttribute("disabled"),
      );
      expect(enabledDispatch).toBeDefined();
    });
  });

  describe("1Campus Sync Foolproof (#761)", () => {
    it("syncs immediately without a dialog when the teacher has no organization", async () => {
      const user = userEvent.setup();
      mockWorkspace.organizations = [];
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const syncButton = screen.getByTitle("Sync 1Campus tooltip");
      await user.click(syncButton);

      await waitFor(() => {
        expect(mockSyncOneCampusClasses).toHaveBeenCalledTimes(1);
      });
      // No confirmation dialog for personal-only teachers.
      expect(
        screen.queryByText("Sync into your personal account?"),
      ).not.toBeInTheDocument();
    });

    it("shows a confirmation dialog (and does not sync yet) when the teacher belongs to an organization", async () => {
      const user = userEvent.setup();
      mockWorkspace.organizations = [{ id: "org-1", name: "Test Org" }];
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const syncButton = screen.getByTitle("Sync 1Campus tooltip");
      await user.click(syncButton);

      await waitFor(() => {
        expect(
          screen.getByText("Sync into your personal account?"),
        ).toBeInTheDocument();
      });
      // Sync must not fire until the teacher confirms.
      expect(mockSyncOneCampusClasses).not.toHaveBeenCalled();
    });

    it("runs the sync after the teacher confirms in the dialog", async () => {
      const user = userEvent.setup();
      mockWorkspace.organizations = [{ id: "org-1", name: "Test Org" }];
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByTitle("Sync 1Campus tooltip"));
      await waitFor(() => {
        expect(
          screen.getByText("Sync into your personal account?"),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Sync anyway" }));

      await waitFor(() => {
        expect(mockSyncOneCampusClasses).toHaveBeenCalledTimes(1);
      });
    });

    it("does not sync when the teacher cancels the dialog", async () => {
      const user = userEvent.setup();
      mockWorkspace.organizations = [{ id: "org-1", name: "Test Org" }];
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByTitle("Sync 1Campus tooltip"));
      await waitFor(() => {
        expect(
          screen.getByText("Sync into your personal account?"),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(
          screen.queryByText("Sync into your personal account?"),
        ).not.toBeInTheDocument();
      });
      expect(mockSyncOneCampusClasses).not.toHaveBeenCalled();
    });
  });

  describe("Classroom Grade (#1097)", () => {
    const findGradeFilter = () =>
      screen
        .getAllByRole("combobox")
        .find((s) =>
          Array.from(s.querySelectorAll("option")).some(
            (o) => o.textContent === "All Grades",
          ),
        );

    it("shows the grade column with labels and Not set", async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const table = screen.getByRole("table");
      expect(table.textContent).toContain("Grade 3");
      expect(table.textContent).toContain("Grade 5");
      expect(table.textContent).toContain("Not set");
    });

    it("narrows the list with the grade filter", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const gradeFilter = findGradeFilter();
      expect(gradeFilter).toBeDefined();

      await user.selectOptions(gradeFilter!, "3");
      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
        expect(screen.queryByText("Beta Class")).not.toBeInTheDocument();
        expect(screen.queryByText("Charlie Class")).not.toBeInTheDocument();
      });

      await user.selectOptions(gradeFilter!, "unset");
      await waitFor(() => {
        expect(screen.getAllByText("Charlie Class").length).toBeGreaterThan(0);
        expect(screen.queryByText("Alpha Class")).not.toBeInTheDocument();
      });
    });

    it("blocks creating a classroom without a grade", async () => {
      const user = userEvent.setup();
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      await user.click(
        screen.getAllByRole("button", { name: /Add Classroom/ })[0],
      );
      await user.type(screen.getByPlaceholderText("e.g., Grade 5"), "New");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(alertSpy).toHaveBeenCalledWith("Please select a grade");
      expect(mockCreateClassroom).not.toHaveBeenCalled();

      await user.selectOptions(screen.getByLabelText("Grade"), "4");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(mockCreateClassroom).toHaveBeenCalledWith(
          expect.objectContaining({ name: "New", grade: 4 }),
        );
      });
    });

    it("does not expand the row when clicking its checkbox", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      const rowCheckbox = screen
        .getAllByRole("checkbox", { name: "Select Alpha Class" })
        .find((el) => el.closest("tr"));
      expect(rowCheckbox).toBeDefined();

      await user.click(rowCheckbox!);

      expect(rowCheckbox).toHaveAttribute("data-state", "checked");
      // Expanded detail row (with "Program Count") must not appear
      expect(screen.queryByText("Program Count")).not.toBeInTheDocument();
      // Bulk bar appears instead
      expect(
        screen.getByRole("toolbar", { name: "1 classroom(s) selected" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Adjust grade/ }),
      ).toBeInTheDocument();
    });

    it("shows the missing-grade banner when a classroom has no grade", async () => {
      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByText("1 classroom(s) have no grade set"),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByRole("button", { name: "Set now" }),
      ).toBeInTheDocument();
    });

    it("hides the banner when every classroom has a grade", async () => {
      mockGetTeacherClassrooms.mockResolvedValue([
        mockClassrooms[0],
        mockClassrooms[1],
      ]);
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });
      expect(screen.queryByText(/have no grade set/)).not.toBeInTheDocument();
    });

    const tickRow = async (
      user: ReturnType<typeof userEvent.setup>,
      name: string,
    ) => {
      const checkbox = screen
        .getAllByRole("checkbox", { name: `Select ${name}` })
        .find((el) => el.closest("tr"));
      expect(checkbox).toBeDefined();
      await user.click(checkbox!);
    };

    it("adjusts only the classrooms that can move and skips unset ones", async () => {
      const user = userEvent.setup();
      mockBatchSetClassroomGrades.mockResolvedValue({
        updated: [{ id: 1, grade: 4 }],
        count: 1,
      });
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      await tickRow(user, "Alpha Class"); // grade 3
      await tickRow(user, "Charlie Class"); // unset
      expect(
        screen.getByRole("toolbar", { name: "2 classroom(s) selected" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Adjust grade/ }));
      await waitFor(() => {
        expect(screen.getByText("Adjust grade dialog")).toBeInTheDocument();
      });
      // Default direction is "up"; Charlie is listed as skipped
      expect(screen.getByText("1 classroom(s) skipped")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Apply (1)" }));

      await waitFor(() => {
        expect(mockBatchSetClassroomGrades).toHaveBeenCalledTimes(1);
      });
      expect(mockBatchSetClassroomGrades).toHaveBeenCalledWith([
        { classroom_id: 1, grade: 4 },
      ]);
      // Selection is cleared after a successful adjust
      await waitFor(() => {
        expect(screen.queryByTestId("grade-bulk-bar")).not.toBeInTheDocument();
      });
    });

    it("shows a reload-failed toast when the background reload fails after a save", async () => {
      const user = userEvent.setup();
      mockBatchSetClassroomGrades.mockResolvedValue({
        updated: [{ id: 3, grade: 2 }],
        count: 1,
      });
      // 1st call: initial load succeeds; 2nd call: background reload fails
      mockGetTeacherClassrooms
        .mockResolvedValueOnce(mockClassrooms)
        .mockRejectedValueOnce(new Error("network"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      await user.click(screen.getByRole("button", { name: "Set now" }));
      const rowSelect = await screen.findByLabelText("Grade for Charlie Class");
      await user.selectOptions(rowSelect, "2");
      await user.click(screen.getByRole("button", { name: "Save (1)" }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Saved, but the list could not be reloaded",
        );
      });
      // The save itself still reports success
      expect(mockToastSuccess).toHaveBeenCalledWith("Updated 1 classroom(s)");
      expect(mockGetTeacherClassrooms).toHaveBeenCalledTimes(2);
      // The page stays rendered (no full-page loading / blank state)
      expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
    });

    it("keeps the row selection when saving from the fill-in dialog", async () => {
      const user = userEvent.setup();
      mockBatchSetClassroomGrades.mockResolvedValue({
        updated: [{ id: 3, grade: 2 }],
        count: 1,
      });
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      await tickRow(user, "Alpha Class");
      expect(
        screen.getByRole("toolbar", { name: "1 classroom(s) selected" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Set now" }));
      const rowSelect = await screen.findByLabelText("Grade for Charlie Class");
      await user.selectOptions(rowSelect, "2");
      await user.click(screen.getByRole("button", { name: "Save (1)" }));

      await waitFor(() => {
        expect(mockBatchSetClassroomGrades).toHaveBeenCalledWith([
          { classroom_id: 3, grade: 2 },
        ]);
      });
      await waitFor(() => {
        expect(
          screen.queryByText("Set classroom grades"),
        ).not.toBeInTheDocument();
      });
      expect(
        screen.getByRole("toolbar", { name: "1 classroom(s) selected" }),
      ).toBeInTheDocument();
    });

    it("clears the selection when the grade filter changes", async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

      await tickRow(user, "Alpha Class");
      expect(
        screen.getByRole("toolbar", { name: "1 classroom(s) selected" }),
      ).toBeInTheDocument();

      await user.selectOptions(findGradeFilter()!, "3");
      await waitFor(() => {
        expect(screen.queryByTestId("grade-bulk-bar")).not.toBeInTheDocument();
      });
    });

    it("hides checkboxes and the banner in organization mode", async () => {
      mockWorkspace.mode = "organization";
      mockWorkspace.selectedOrganization = { id: "org-1", name: "Test Org" };
      mockGetTeacherClassrooms.mockResolvedValue([
        { ...mockClassrooms[2], organization_id: "org-1" },
      ]);
      renderComponent();

      await waitFor(() => {
        expect(screen.getAllByText("Charlie Class").length).toBeGreaterThan(0);
      });
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      expect(screen.queryByText(/have no grade set/)).not.toBeInTheDocument();
    });
  });

  describe("Columns, inline edit and status (#1097 round 3)", () => {
    const withInactiveBeta = () =>
      mockGetTeacherClassrooms.mockResolvedValue([
        { ...mockClassrooms[0], is_active: true },
        { ...mockClassrooms[1], is_active: false },
        { ...mockClassrooms[2], is_active: true },
      ]);

    const tableNames = () =>
      Array.from(screen.getByRole("table").querySelectorAll("tbody a")).map(
        (a) => a.textContent,
      );

    const row = (id: number) => screen.getByTestId(`classroom-row-${id}`);

    const waitForList = () =>
      waitFor(() => {
        expect(screen.getAllByText("Alpha Class").length).toBeGreaterThan(0);
      });

    const tickRow = async (
      user: ReturnType<typeof userEvent.setup>,
      name: string,
    ) => {
      const checkbox = screen
        .getAllByRole("checkbox", { name: `Select ${name}` })
        .find((el) => el.closest("tr"));
      await user.click(checkbox!);
    };

    beforeEach(() => {
      mockUpdateClassroom.mockResolvedValue({});
      mockBatchUpdateClassrooms.mockResolvedValue({ updated: [], count: 0 });
    });

    it("orders the desktop columns grade first and ends with status and actions", async () => {
      renderComponent();
      await waitForList();

      const headers = within(screen.getByRole("table"))
        .getAllByRole("columnheader")
        .map((h) => h.textContent);
      expect(headers).toEqual([
        "",
        "Grade",
        "Classroom Name",
        "Level",
        "Student Count",
        "Created At",
        "Status",
        "Actions",
      ]);
    });

    it("sorts by grade with unset grades last in both directions", async () => {
      const user = userEvent.setup();
      renderComponent();
      await waitForList();

      await user.click(screen.getByRole("button", { name: "Grade" }));
      await waitFor(() => {
        expect(tableNames()).toEqual([
          "Alpha Class",
          "Beta Class",
          "Charlie Class",
        ]);
      });

      await user.click(screen.getByRole("button", { name: "Grade" }));
      await waitFor(() => {
        expect(tableNames()).toEqual([
          "Beta Class",
          "Alpha Class",
          "Charlie Class",
        ]);
      });
    });

    it("filters by status", async () => {
      const user = userEvent.setup();
      withInactiveBeta();
      renderComponent();
      await waitForList();

      const statusFilter = screen.getByRole("combobox", {
        name: "Filter by status",
      });
      await user.selectOptions(statusFilter, "inactive");
      await waitFor(() => {
        expect(tableNames()).toEqual(["Beta Class"]);
      });

      await user.selectOptions(statusFilter, "active");
      await waitFor(() => {
        expect(tableNames()).toEqual(["Alpha Class", "Charlie Class"]);
      });
    });

    it("disables dispatch for an inactive classroom but keeps edit enabled", async () => {
      withInactiveBeta();
      renderComponent();
      await waitForList();

      const betaRow = row(2);
      expect(within(betaRow).getByText("Inactive")).toBeInTheDocument();
      expect(within(betaRow).getByTitle("Classroom inactive")).toBeDisabled();
      expect(within(betaRow).getByTitle("Edit")).not.toBeDisabled();
      expect(within(row(1)).getByTitle("Assign Homework")).not.toBeDisabled();
    });

    it("deactivates a single classroom from the row switch", async () => {
      const user = userEvent.setup();
      renderComponent();
      await waitForList();

      const toggle = within(row(1)).getByRole("switch", {
        name: "Toggle Alpha Class",
      });
      expect(toggle).toHaveAttribute("data-state", "checked");
      await user.click(toggle);

      await waitFor(() => {
        expect(mockUpdateClassroom).toHaveBeenCalledWith(1, {
          is_active: false,
        });
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("Deactivated Alpha Class");
      // Clicking the switch does not expand the row
      expect(screen.queryByText("Program Count")).not.toBeInTheDocument();
    });

    it("edits a row inline and saves the draft", async () => {
      const user = userEvent.setup();
      renderComponent();
      await waitForList();

      await user.click(within(row(1)).getByTitle("Edit"));

      const nameInput = within(row(1)).getByLabelText("Classroom Name");
      expect(nameInput).toHaveValue("Alpha Class");
      await user.clear(nameInput);
      await user.type(nameInput, "Alpha Two");
      await user.selectOptions(within(row(1)).getByLabelText("Level"), "B1");
      await user.selectOptions(within(row(1)).getByLabelText("Grade"), "4");

      await user.click(within(row(1)).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(mockUpdateClassroom).toHaveBeenCalledWith(1, {
          name: "Alpha Two",
          description: "First class",
          level: "B1",
          grade: 4,
        });
      });
      await waitFor(() => {
        expect(
          within(row(1)).queryByLabelText("Classroom Name"),
        ).not.toBeInTheDocument();
      });
      // Clicking inside the editing row did not expand it
      expect(screen.queryByText("Program Count")).not.toBeInTheDocument();
    });

    it("cancels inline editing with Escape", async () => {
      const user = userEvent.setup();
      renderComponent();
      await waitForList();

      await user.click(within(row(1)).getByTitle("Edit"));
      const nameInput = within(row(1)).getByLabelText("Classroom Name");
      await user.type(nameInput, "{Escape}");

      expect(
        within(row(1)).queryByLabelText("Classroom Name"),
      ).not.toBeInTheDocument();
      expect(mockUpdateClassroom).not.toHaveBeenCalled();
    });

    it("asks before discarding unsaved changes and stays on the row when cancelled", async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderComponent();
      await waitForList();

      await user.click(within(row(1)).getByTitle("Edit"));
      await user.type(within(row(1)).getByLabelText("Classroom Name"), "!");

      await user.click(within(row(2)).getByTitle("Edit"));

      expect(confirmSpy).toHaveBeenCalledWith(
        "You have unsaved changes. Discard them?",
      );
      expect(within(row(1)).getByLabelText("Classroom Name")).toHaveValue(
        "Alpha Class!",
      );
      expect(
        within(row(2)).queryByLabelText("Classroom Name"),
      ).not.toBeInTheDocument();

      // Confirming switches to the other row
      confirmSpy.mockReturnValue(true);
      await user.click(within(row(2)).getByTitle("Edit"));
      expect(within(row(2)).getByLabelText("Classroom Name")).toHaveValue(
        "Beta Class",
      );
      expect(
        within(row(1)).queryByLabelText("Classroom Name"),
      ).not.toBeInTheDocument();
    });

    it("does not ask when switching rows without changes", async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, "confirm");
      renderComponent();
      await waitForList();

      await user.click(within(row(1)).getByTitle("Edit"));
      await user.click(within(row(2)).getByTitle("Edit"));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(
        within(row(2)).getByLabelText("Classroom Name"),
      ).toBeInTheDocument();
    });

    it("bulk-deactivates the selected classrooms after confirming", async () => {
      const user = userEvent.setup();
      mockBatchUpdateClassrooms.mockResolvedValue({
        updated: [{ id: 1, grade: 3, level: "A1", is_active: false }],
        count: 1,
      });
      renderComponent();
      await waitForList();

      await tickRow(user, "Alpha Class");
      const toolbar = screen.getByRole("toolbar", {
        name: "1 classroom(s) selected",
      });
      await user.click(
        within(toolbar).getByRole("button", { name: "Deactivate" }),
      );

      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText("Deactivate 1 classroom(s)?"),
      ).toBeInTheDocument();
      await user.click(
        within(dialog).getByRole("button", { name: "Deactivate" }),
      );

      await waitFor(() => {
        expect(mockBatchUpdateClassrooms).toHaveBeenCalledWith([
          { classroom_id: 1, is_active: false },
        ]);
      });
      await waitFor(() => {
        expect(screen.queryByTestId("grade-bulk-bar")).not.toBeInTheDocument();
      });
    });

    it("bulk-adjusts the level and skips classrooms already at the target", async () => {
      const user = userEvent.setup();
      mockBatchUpdateClassrooms.mockResolvedValue({
        updated: [{ id: 1, grade: 3, level: "B1", is_active: true }],
        count: 1,
      });
      renderComponent();
      await waitForList();

      await tickRow(user, "Alpha Class"); // A1
      await tickRow(user, "Beta Class"); // B1
      await user.click(screen.getByRole("button", { name: "Adjust level" }));

      const dialog = await screen.findByRole("dialog");
      await user.selectOptions(
        within(dialog).getByLabelText("Target level"),
        "B1",
      );
      expect(
        within(dialog).getByText("1 classroom(s) skipped"),
      ).toBeInTheDocument();
      await user.click(
        within(dialog).getByRole("button", { name: "Apply (1)" }),
      );

      await waitFor(() => {
        expect(mockBatchUpdateClassrooms).toHaveBeenCalledWith([
          { classroom_id: 1, level: "B1" },
        ]);
      });
    });

    it("disables the editing row's checkbox and hides bulk actions and the fill-in action while editing", async () => {
      const user = userEvent.setup();
      renderComponent();
      await waitForList();

      await tickRow(user, "Beta Class");
      expect(screen.getByTestId("grade-bulk-bar")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Set now" }),
      ).toBeInTheDocument();

      await user.click(within(row(1)).getByTitle("Edit"));

      expect(
        within(row(1)).getByRole("checkbox", { name: "Select Alpha Class" }),
      ).toBeDisabled();
      expect(screen.queryByTestId("grade-bulk-bar")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Set now" }),
      ).not.toBeInTheDocument();
      // The banner message itself stays
      expect(
        screen.getByText("1 classroom(s) have no grade set"),
      ).toBeInTheDocument();

      // Select-all skips the editing row
      await user.click(
        within(screen.getByRole("table")).getByRole("checkbox", {
          name: "Select all listed classrooms",
        }),
      );
      expect(
        within(row(1)).getByRole("checkbox", { name: "Select Alpha Class" }),
      ).not.toHaveAttribute("data-state", "checked");

      // Leaving edit mode brings the bar back
      await user.click(within(row(1)).getByRole("button", { name: "Cancel" }));
      expect(screen.getByTestId("grade-bulk-bar")).toBeInTheDocument();
    });

    it("ignores a stale background reload that resolves after a newer one", async () => {
      const user = userEvent.setup();
      let resolveOlder: (v: unknown) => void = () => {};
      let resolveNewer: (v: unknown) => void = () => {};
      mockGetTeacherClassrooms
        .mockResolvedValueOnce(mockClassrooms)
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolveOlder = resolve)),
        )
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolveNewer = resolve)),
        );
      renderComponent();
      await waitForList();

      // Two single toggles → two silent reloads in flight
      await user.click(
        within(row(1)).getByRole("switch", { name: "Toggle Alpha Class" }),
      );
      await waitFor(() => {
        expect(mockGetTeacherClassrooms).toHaveBeenCalledTimes(2);
      });
      await user.click(
        within(row(3)).getByRole("switch", { name: "Toggle Charlie Class" }),
      );
      await waitFor(() => {
        expect(mockGetTeacherClassrooms).toHaveBeenCalledTimes(3);
      });

      const renamed = (name: string) => [
        { ...mockClassrooms[0], name },
        mockClassrooms[1],
        mockClassrooms[2],
      ];
      resolveNewer(renamed("Newest Alpha"));
      await waitFor(() => {
        expect(screen.getAllByText("Newest Alpha").length).toBeGreaterThan(0);
      });
      resolveOlder(renamed("Stale Alpha"));
      // Give the stale response a chance to (wrongly) apply
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText("Stale Alpha")).not.toBeInTheDocument();
      expect(screen.getAllByText("Newest Alpha").length).toBeGreaterThan(0);
    });

    it("counts only classrooms whose status will change in the confirm dialog", async () => {
      const user = userEvent.setup();
      withInactiveBeta();
      renderComponent();
      await waitForList();

      await tickRow(user, "Alpha Class"); // active
      await tickRow(user, "Beta Class"); // already inactive
      const toolbar = screen.getByRole("toolbar", {
        name: "2 classroom(s) selected",
      });
      await user.click(
        within(toolbar).getByRole("button", { name: "Deactivate" }),
      );

      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText("Deactivate 1 classroom(s)?"),
      ).toBeInTheDocument();
    });

    it("offers every sort field in both directions on mobile", async () => {
      renderComponent();
      await waitForList();

      const mobileSort = screen
        .getAllByRole("combobox")
        .find((s) =>
          Array.from(s.querySelectorAll("option")).some(
            (o) => o.getAttribute("value") === "default",
          ),
        );
      const values = Array.from(mobileSort!.querySelectorAll("option")).map(
        (o) => o.getAttribute("value"),
      );
      for (const field of [
        "grade",
        "name",
        "level",
        "student_count",
        "created_at",
      ]) {
        expect(values).toContain(`${field}_asc`);
        expect(values).toContain(`${field}_desc`);
      }
      expect(
        screen.getByRole("option", { name: "Fewest Students" }),
      ).toHaveValue("student_count_asc");
    });

    it("counts only active classrooms in the active stat card", async () => {
      withInactiveBeta();
      renderComponent();
      await waitForList();

      const activeCard = screen.getByText("Active Classrooms").parentElement!;
      expect(activeCard).toHaveTextContent("Active Classrooms2");
      const totalCard = screen.getByText("Total Classrooms").parentElement!;
      expect(totalCard).toHaveTextContent("Total Classrooms3");
    });

    it("renders no status switch in organization mode", async () => {
      mockWorkspace.mode = "organization";
      mockWorkspace.selectedOrganization = { id: "org-1", name: "Test Org" };
      mockGetTeacherClassrooms.mockResolvedValue([
        { ...mockClassrooms[0], organization_id: "org-1" },
      ]);
      renderComponent();
      await waitForList();

      expect(screen.queryAllByRole("switch")).toHaveLength(0);
      expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no classrooms", async () => {
      mockGetTeacherClassrooms.mockResolvedValue([]);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText("No classrooms yet")).toBeInTheDocument();
      });
    });
  });
});
