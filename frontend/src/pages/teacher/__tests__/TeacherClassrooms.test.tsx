import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
      };
      if (key === "teacherClassrooms.messages.totalCount" && opts) {
        return `Total ${opts.count} classrooms`;
      }
      return translations[key] || key;
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
vi.mock("@/lib/api", () => ({
  apiClient: {
    getTeacherClassrooms: (...args: unknown[]) =>
      mockGetTeacherClassrooms(...args),
    syncOneCampusClasses: (...args: unknown[]) =>
      mockSyncOneCampusClasses(...args),
    createClassroom: vi.fn(),
    updateClassroom: vi.fn(),
    deleteClassroom: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status?: number;
  },
}));

const mockClassrooms = [
  {
    id: 1,
    name: "Alpha Class",
    description: "First class",
    level: "A1",
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
