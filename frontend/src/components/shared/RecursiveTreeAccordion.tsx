import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Edit,
  Trash2,
  GripVertical,
  LucideIcon,
  MoreHorizontal,
  Zap,
} from "lucide-react";

// Level-based color system - flat design with colored left accent
const getLevelColors = (level: number) => {
  switch (level) {
    case 0: // Program level - blue accent
      return {
        accent: "border-l-4 border-l-blue-500",
        bg: "bg-white dark:bg-gray-800",
        shadow: "shadow-sm hover:shadow-md",
      };
    case 1: // Lesson level - emerald accent
      return {
        accent: "border-l-4 border-l-emerald-500",
        bg: "bg-gray-50/80 dark:bg-gray-800/80",
        shadow: "shadow-sm hover:shadow-md",
      };
    case 2: // Content level - violet accent
    default:
      return {
        accent: "border-l-4 border-l-violet-500",
        bg: "bg-gray-100/60 dark:bg-gray-700/50",
        shadow: "shadow-sm hover:shadow",
      };
  }
};
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface TreeNodeConfig {
  // Display config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: LucideIcon | ((item: any) => LucideIcon);
  colorScheme: {
    bg: string;
    text: string;
    iconBg: string;
    iconText: string;
    hoverBg?: string;
  };

  // Data keys
  idKey: string; // 'id'
  nameKey: string; // 'name'
  descriptionKey?: string; // 'description'
  childrenKey?: string; // 'lessons', 'contents', etc.

  // Display fields (badges, metadata)
  displayFields?: {
    key: string;
    icon?: LucideIcon;
    suffix?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render?: (value: any, item: any) => React.ReactNode;
    mobileOnly?: boolean;
    desktopOnly?: boolean;
  }[];

  // Behavior
  canEdit?: boolean;
  canDelete?: boolean;
  canDrag?: boolean;
  canExpand?: boolean; // false for leaf nodes

  // Child config (for next level)
  childConfig?: TreeNodeConfig;

  // Custom empty message
  emptyMessage?: string;

  // Filter function for children (return true to include, false to exclude)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filterChildren?: (child: any) => boolean;
}

interface RecursiveTreeNodeProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  config: TreeNodeConfig;
  level: number;
  index: number;
  parentId?: string | number;

  // Event handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEdit?: (item: any, level: number, parentId?: string | number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDelete?: (item: any, level: number, parentId?: string | number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick?: (item: any, level: number, parentId?: string | number) => void;
  onCreate?: (level: number, parentId: string | number) => void;
  onReorder?: (
    fromIndex: number,
    toIndex: number,
    level: number,
    parentId?: string | number,
  ) => void;
  onInstantPractice?: (
    item: Record<string, unknown>,
    level: number,
    parentId?: string | number,
  ) => void;

  // Accordion state
  expandedValue: string;
  onExpandedChange: (value: string) => void;

  // Disable actions
  disableActions?: boolean;
  disableReason?: string;
}

function RecursiveTreeNode({
  data,
  config,
  level,
  index,
  parentId,
  onEdit,
  onDelete,
  onClick,
  onCreate,
  onReorder,
  onInstantPractice,
  disableActions = false,
  disableReason = "",
}: RecursiveTreeNodeProps) {
  const itemId = data[config.idKey];
  const itemName = data[config.nameKey];
  const itemDescription = config.descriptionKey
    ? data[config.descriptionKey]
    : null;
  // Get children and apply filter if defined in childConfig
  const rawChildren = config.childrenKey ? data[config.childrenKey] : null;
  const children =
    rawChildren && config.childConfig?.filterChildren
      ? rawChildren.filter(config.childConfig.filterChildren)
      : rawChildren;

  const accordionValue = `${level}-${itemId}`;

  // Child accordion state (for next level)
  const [childExpandedValue, setChildExpandedValue] = useState("");

  // @dnd-kit sortable hook
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: itemId,
    data: {
      type: "tree-node",
      level,
      index,
      parentId,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Get level-based colors
  const levelColors = getLevelColors(level);

  // Render node (can be accordion or simple div)
  const nodeContent = (
    <div
      ref={setNodeRef}
      style={style}
      className="relative"
      data-dragging={isDragging ? "true" : "false"}
    >
      {config.canExpand !== false ? (
        // Expandable node - flat design with colored accent
        <div
          className={`${levelColors.accent} ${levelColors.bg} ${levelColors.shadow} rounded-[0.15rem] mb-3 transition-shadow duration-200`}
        >
          <AccordionItem
            value={accordionValue}
            className={`border-none transition-opacity duration-200 ${isDragging ? "opacity-30" : ""}`}
          >
            <AccordionTrigger
              hideChevron={true}
              className="hover:no-underline group px-3 sm:px-4 py-2.5 sm:py-3"
            >
              <div className="flex flex-col w-full gap-1.5 sm:gap-0">
                {/* Row 1: Icon + Name + (Desktop: fields + menu) / (Mobile: menu only) */}
                <div className="flex items-center justify-between w-full gap-2">
                  {/* Left side: drag handle + icon + name/description */}
                  <div className="flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0 max-w-[calc(100%-100px)] sm:max-w-[calc(100%-120px)]">
                    {/* Drag handle - desktop only */}
                    {config.canDrag && (
                      <div
                        {...attributes}
                        {...listeners}
                        className="hidden sm:block cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity select-none flex-shrink-0"
                        title="拖曳以重新排序"
                      >
                        <GripVertical className="h-4 w-4 text-gray-400" />
                      </div>
                    )}

                    {/* Icon */}
                    <div
                      className={`w-7 h-7 sm:w-9 sm:h-9 ${config.colorScheme.iconBg} rounded-md flex items-center justify-center flex-shrink-0`}
                    >
                      {(() => {
                        const IconComponent =
                          typeof config.icon === "function" &&
                          !("render" in config.icon)
                            ? (
                                config.icon as (
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  item: any,
                                ) => LucideIcon
                              )(data)
                            : (config.icon as LucideIcon);
                        return (
                          <IconComponent
                            className={`h-4 w-4 sm:h-5 sm:w-5 ${config.colorScheme.iconText}`}
                          />
                        );
                      })()}
                    </div>

                    {/* Name and description */}
                    <div className="text-left flex-1 min-w-0 overflow-hidden">
                      <h4 className="font-semibold text-sm sm:text-base dark:text-gray-100 line-clamp-2 break-words">
                        {itemName}
                      </h4>
                      {itemDescription && (
                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 whitespace-pre-line break-words line-clamp-3">
                          {itemDescription}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right side: Desktop display fields + more menu */}
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {/* Desktop display fields */}
                    {config.displayFields &&
                      config.displayFields
                        .filter((field) => !field.mobileOnly)
                        .map((field, idx) => (
                          <div key={idx} className="hidden sm:block">
                            {field.render
                              ? field.render(data[field.key], data)
                              : field.icon && (
                                  <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                                    <field.icon className="h-4 w-4 mr-1" />
                                    <span>
                                      {data[field.key]}
                                      {field.suffix}
                                    </span>
                                  </div>
                                )}
                          </div>
                        ))}

                    {/* More menu (⋯) with edit/delete */}
                    {(config.canEdit || config.canDelete) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <div
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                (e.currentTarget as HTMLDivElement).click();
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            className="h-7 w-7 sm:h-8 sm:w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                          >
                            <MoreHorizontal className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                          </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                        >
                          {config.canEdit && onEdit && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!disableActions)
                                  onEdit(data, level, parentId);
                              }}
                              className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                              disabled={disableActions}
                              title={disableActions ? disableReason : ""}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              編輯
                            </DropdownMenuItem>
                          )}
                          {config.canDelete && onDelete && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!disableActions)
                                  onDelete(data, level, parentId);
                              }}
                              className="cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 focus:text-red-600"
                              disabled={disableActions}
                              title={disableActions ? disableReason : ""}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              刪除
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>

                {/* Row 2 (Mobile only): Display fields - tags, time, etc. */}
                {config.displayFields &&
                  config.displayFields.filter((field) => !field.desktopOnly)
                    .length > 0 && (
                    <div className="flex sm:hidden items-center gap-2 pl-9 flex-wrap">
                      {config.displayFields
                        .filter((field) => !field.desktopOnly)
                        .map((field, idx) => (
                          <div key={idx}>
                            {field.render
                              ? field.render(data[field.key], data)
                              : field.icon && (
                                  <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                                    <field.icon className="h-3 w-3 mr-0.5" />
                                    <span>
                                      {data[field.key]}
                                      {field.suffix}
                                    </span>
                                  </div>
                                )}
                          </div>
                        ))}
                    </div>
                  )}
              </div>
            </AccordionTrigger>

            <AccordionContent>
              {/* Tags shown when expanded */}
              {data.tags &&
                Array.isArray(data.tags) &&
                data.tags.length > 0 && (
                  <div className="px-3 sm:px-4 pt-1 pb-2">
                    <div className="flex flex-wrap gap-1.5">
                      {data.tags.map((tag: string, index: number) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              {/* Children content - full width, no indentation */}
              <div className="px-2 sm:px-3 pb-3 space-y-0">
                {config.childConfig ? (
                  <>
                    <SortableContext
                      items={
                        children?.map(
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (child: any) => child[config.childConfig!.idKey],
                        ) || []
                      }
                      strategy={verticalListSortingStrategy}
                    >
                      <Accordion
                        type="single"
                        collapsible
                        className="w-full"
                        value={childExpandedValue}
                        onValueChange={setChildExpandedValue}
                      >
                        {children &&
                          children.length > 0 &&
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          children.map((child: any, childIndex: number) => (
                            <RecursiveTreeNode
                              key={child[config.childConfig!.idKey]}
                              data={child}
                              config={config.childConfig!}
                              level={level + 1}
                              index={childIndex}
                              parentId={itemId}
                              onEdit={onEdit}
                              onDelete={onDelete}
                              onClick={onClick}
                              onCreate={onCreate}
                              onReorder={onReorder}
                              onInstantPractice={onInstantPractice}
                              expandedValue={childExpandedValue}
                              onExpandedChange={setChildExpandedValue}
                              disableActions={disableActions}
                              disableReason={disableReason}
                            />
                          ))}
                      </Accordion>
                    </SortableContext>
                    {onCreate && (
                      <button
                        onClick={() => onCreate(level + 1, itemId)}
                        className={`w-full py-2.5 pl-3 sm:pl-4 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ${getLevelColors(level + 1).accent} bg-gray-50/50 dark:bg-gray-800/30 hover:bg-gray-100/80 dark:hover:bg-gray-700/50 rounded-[0.15rem] transition-colors flex items-center justify-start gap-1.5`}
                      >
                        <span className="text-base">+</span>
                        <span>
                          新增
                          {config.childConfig?.nameKey === "name"
                            ? "單元"
                            : "內容"}
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    {children &&
                      children.length > 0 &&
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      children.map((child: any) => (
                        <div
                          key={child[config.childConfig!.idKey]}
                          className="p-3 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 cursor-pointer transition-colors"
                          onClick={() => onClick?.(child, level + 1, itemId)}
                        >
                          {child.name || child.title || "未命名"}
                        </div>
                      ))}
                  </div>
                )}
                {!children || children.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">
                    {config.childConfig?.emptyMessage || "暫無內容"}
                  </p>
                ) : null}
              </div>
            </AccordionContent>
          </AccordionItem>
        </div>
      ) : (
        // Leaf node (no children) - flat design with colored accent
        <div
          className={`p-2.5 sm:p-3 mb-3 ${levelColors.accent} ${levelColors.bg} ${levelColors.shadow} rounded-[0.15rem] cursor-pointer transition-all duration-200 group ${isDragging ? "opacity-30" : ""}`}
          onClick={() => onClick?.(data, level, parentId)}
        >
          <div className="flex items-center justify-between gap-2">
            {/* Left side: drag handle + icon + name */}
            <div className="flex items-center space-x-2 flex-1 min-w-0 max-w-[calc(100%-80px)] sm:max-w-[calc(100%-100px)]">
              {config.canDrag && (
                <div
                  {...attributes}
                  {...listeners}
                  className="hidden sm:block cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity select-none flex-shrink-0"
                >
                  <GripVertical className="h-4 w-4 text-gray-400" />
                </div>
              )}
              <div
                className={`w-6 h-6 sm:w-7 sm:h-7 ${config.colorScheme.iconBg} rounded-md flex items-center justify-center flex-shrink-0`}
              >
                {(() => {
                  const IconComponent =
                    typeof config.icon === "function" &&
                    !("render" in config.icon)
                      ? (
                          config.icon as (
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            item: any,
                          ) => LucideIcon
                        )(data)
                      : (config.icon as LucideIcon);
                  return (
                    <IconComponent
                      className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${config.colorScheme.iconText}`}
                    />
                  );
                })()}
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p
                  className={`font-medium text-sm ${config.colorScheme.text} line-clamp-2 break-words`}
                >
                  {itemName}
                </p>
                {itemDescription && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-line break-words line-clamp-3">
                    {itemDescription}
                  </p>
                )}
              </div>
            </div>

            {/* Right side: display fields + more menu */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {config.displayFields?.map((field, idx) => (
                <span
                  key={idx}
                  className="text-xs sm:text-sm text-gray-500 dark:text-gray-400"
                >
                  {field.render
                    ? field.render(data[field.key], data)
                    : `${data[field.key]}${field.suffix || ""}`}
                </span>
              ))}

              {/* More menu (⋯) with instant practice + delete */}
              {(onInstantPractice || (config.canDelete && onDelete)) && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 w-6 sm:h-7 sm:w-7 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-500 dark:text-gray-400" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                  >
                    {onInstantPractice && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          onInstantPractice(data, level, parentId);
                        }}
                        className="cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      >
                        <Zap className="h-4 w-4 mr-2 text-amber-500" />
                        即刻練習
                      </DropdownMenuItem>
                    )}
                    {config.canDelete && onDelete && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(data, level, parentId);
                        }}
                        className="cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 focus:text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        刪除
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return nodeContent;
}

interface RecursiveTreeAccordionProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  config: TreeNodeConfig;
  title?: string;
  showCreateButton?: boolean;
  createButtonText?: string;
  onCreateClick?: () => void;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEdit?: (item: any, level: number, parentId?: string | number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDelete?: (item: any, level: number, parentId?: string | number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick?: (item: any, level: number, parentId?: string | number) => void;
  onCreate?: (level: number, parentId: string | number) => void;
  onReorder?: (
    fromIndex: number,
    toIndex: number,
    level: number,
    parentId?: string | number,
  ) => void;
  onInstantPractice?: (
    item: Record<string, unknown>,
    level: number,
    parentId?: string | number,
  ) => void;
  disableActions?: boolean;
  disableReason?: string;
}

export function RecursiveTreeAccordion({
  data,
  config,
  title,
  showCreateButton,
  createButtonText = "新增",
  onCreateClick,
  onEdit,
  onDelete,
  onClick,
  onCreate,
  onReorder,
  onInstantPractice,
  disableActions = false,
  disableReason = "",
}: RecursiveTreeAccordionProps) {
  const [expandedValue, setExpandedValue] = useState("");
  const [activeId, setActiveId] = useState<string | number | null>(null);

  // Set up sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement required to start drag (reduced for better UX)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    console.log("[RecursiveTreeAccordion] Drag End:", {
      activeId: active.id,
      overId: over?.id,
      hasOnReorder: !!onReorder,
    });

    if (over && active.id !== over.id && onReorder) {
      const activeData = active.data.current;
      const overData = over.data.current;

      console.log("[RecursiveTreeAccordion] Active/Over Data:", {
        active: activeData,
        over: overData,
      });

      // Only reorder if they're at the same level and same parent
      if (
        activeData &&
        overData &&
        activeData.level === overData.level &&
        activeData.parentId === overData.parentId
      ) {
        const level = activeData.level;
        const parentId = activeData.parentId;

        // Use the index from the data directly
        const oldIndex = activeData.index;
        const newIndex = overData.index;

        if (oldIndex !== undefined && newIndex !== undefined) {
          console.log("[RecursiveTreeAccordion] Calling onReorder:", {
            oldIndex,
            newIndex,
            level,
            parentId,
          });
          onReorder(oldIndex, newIndex, level, parentId);
        } else {
          console.warn("[RecursiveTreeAccordion] Invalid indices:", {
            oldIndex,
            newIndex,
          });
        }
      } else {
        console.warn(
          "[RecursiveTreeAccordion] Reorder rejected - different level or parent",
        );
      }
    }

    setActiveId(null);
  };

  // Recursively find the active item in the tree with its config
  const findItemById = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: any[],
    id: string | number,
    cfg: TreeNodeConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { item: any; config: TreeNodeConfig } | null => {
    for (const item of items) {
      if (item[cfg.idKey] === id) {
        return { item, config: cfg };
      }
      if (cfg.childConfig && cfg.childrenKey && item[cfg.childrenKey]) {
        const found = findItemById(item[cfg.childrenKey], id, cfg.childConfig);
        if (found) return found;
      }
    }
    return null;
  };

  const activeData = activeId ? findItemById(data, activeId, config) : null;
  const activeItem = activeData?.item;
  const activeConfig = activeData?.config || config;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div>
        {(title || showCreateButton) && (
          <div className="flex items-center justify-between mb-4">
            {title && <h3 className="text-lg font-semibold">{title}</h3>}
            {showCreateButton && onCreateClick && (
              <button
                onClick={onCreateClick}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={disableActions}
                title={disableActions ? disableReason : ""}
              >
                {createButtonText}
              </button>
            )}
          </div>
        )}

        {data.length > 0 ? (
          <SortableContext
            items={data.map((item) => item[config.idKey])}
            strategy={verticalListSortingStrategy}
          >
            <Accordion
              type="single"
              collapsible
              className="w-full"
              value={expandedValue}
              onValueChange={setExpandedValue}
            >
              {data.map((item, index) => (
                <RecursiveTreeNode
                  key={item[config.idKey]}
                  data={item}
                  config={config}
                  level={0}
                  index={index}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onClick={onClick}
                  onCreate={onCreate}
                  onReorder={onReorder}
                  onInstantPractice={onInstantPractice}
                  expandedValue={expandedValue}
                  onExpandedChange={setExpandedValue}
                  disableActions={disableActions}
                  disableReason={disableReason}
                />
              ))}
            </Accordion>
          </SortableContext>
        ) : (
          <div className="text-center py-12 text-gray-500">
            {config.emptyMessage || "暫無資料"}
          </div>
        )}
      </div>

      {/* Drag overlay for visual feedback */}
      <DragOverlay dropAnimation={null}>
        {activeItem && activeConfig ? (
          <div className="bg-blue-500 text-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium">
            移動:{" "}
            {activeItem[activeConfig.nameKey] ||
              activeItem.name ||
              activeItem.title ||
              "項目"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
