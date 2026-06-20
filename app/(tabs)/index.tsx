import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '../../src/store/AppContext';
import { Priority, Recurrence, RECURRENCE_LABEL, Task } from '../../src/types';
import {
  makeStyles,
  priorityColor,
  priorityLabel,
  radius,
  spacing,
  useTheme,
} from '../../src/theme';
import { Chip, EmptyState, ScreenTitle } from '../../src/components/ui';
import {
  addDays,
  formatClock,
  relativeDayLabel,
  startOfDay,
} from '../../src/utils/time';

type Filter = 'active' | 'completed' | 'all';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];
const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekdays', 'weekly'];
const DUE_OPTIONS: { label: string; offset: number | null }[] = [
  { label: 'No date', offset: null },
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'In 3 days', offset: 3 },
  { label: 'Next week', offset: 7 },
];
const DUE_HOURS = [8, 9, 10, 12, 14, 16, 18, 20];

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const { tasks, addTask, toggleTask, deleteTask, startTimer } = useApp();

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [filter, setFilter] = useState<Filter>('active');
  const [showOptions, setShowOptions] = useState(false);
  const [dueOffset, setDueOffset] = useState<number | null>(null);
  const [dueHour, setDueHour] = useState(9);
  const [recurrence, setRecurrence] = useState<Recurrence>('none');

  const visibleTasks = useMemo(() => {
    const byFilter = tasks.filter((t) => {
      if (filter === 'active') return !t.completed;
      if (filter === 'completed') return t.completed;
      return true;
    });
    const order: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
    return [...byFilter].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      // Open tasks: due ones first, soonest at top.
      if (!a.completed && (a.dueDate || b.dueDate)) {
        const ad = a.dueDate ? Date.parse(a.dueDate) : Infinity;
        const bd = b.dueDate ? Date.parse(b.dueDate) : Infinity;
        if (ad !== bd) return ad - bd;
      }
      if (order[a.priority] !== order[b.priority])
        return order[a.priority] - order[b.priority];
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [tasks, filter]);

  const activeCount = tasks.filter((t) => !t.completed).length;

  const resetComposer = () => {
    setTitle('');
    setPriority('medium');
    setDueOffset(null);
    setDueHour(9);
    setRecurrence('none');
    setShowOptions(false);
  };

  const handleAdd = () => {
    if (!title.trim()) return;
    let dueDate: string | undefined;
    if (dueOffset !== null) {
      const d = startOfDay(addDays(new Date(), dueOffset));
      d.setHours(dueHour, 0, 0, 0);
      dueDate = d.toISOString();
    }
    addTask({ title, priority, dueDate, recurrence });
    resetComposer();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <ScreenTitle
          title="Tasks"
          subtitle={
            activeCount > 0
              ? `${activeCount} task${activeCount === 1 ? '' : 's'} to do`
              : 'All caught up'
          }
        />

        <View style={styles.composer}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Add a task…"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <Pressable
            onPress={() => setShowOptions((s) => !s)}
            style={[styles.optionsButton, showOptions && styles.optionsButtonActive]}
            hitSlop={6}
          >
            <Ionicons
              name="options-outline"
              size={22}
              color={showOptions ? colors.onColor : colors.textMuted}
            />
          </Pressable>
          <Pressable
            onPress={handleAdd}
            style={({ pressed }) => [
              styles.addButton,
              { opacity: title.trim() ? (pressed ? 0.8 : 1) : 0.4 },
            ]}
          >
            <Ionicons name="add" size={26} color={colors.onColor} />
          </Pressable>
        </View>

        <View style={styles.chipRow}>
          {PRIORITIES.map((p) => (
            <Chip
              key={p}
              label={priorityLabel[p]}
              active={priority === p}
              color={priorityColor[p]}
              onPress={() => setPriority(p)}
            />
          ))}
        </View>

        {showOptions && (
          <View style={styles.options}>
            <Text style={styles.optionLabel}>Due date</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.optionScroll}
            >
              {DUE_OPTIONS.map((o) => (
                <Chip
                  key={o.label}
                  label={o.label}
                  active={dueOffset === o.offset}
                  onPress={() => setDueOffset(o.offset)}
                />
              ))}
            </ScrollView>

            {dueOffset !== null && (
              <>
                <Text style={styles.optionLabel}>Remind me at</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.optionScroll}
                >
                  {DUE_HOURS.map((h) => (
                    <Chip
                      key={h}
                      label={labelForHour(h)}
                      active={dueHour === h}
                      color={colors.accent}
                      onPress={() => setDueHour(h)}
                    />
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={styles.optionLabel}>Repeat</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.optionScroll}
            >
              {RECURRENCES.map((r) => (
                <Chip
                  key={r}
                  label={RECURRENCE_LABEL[r]}
                  active={recurrence === r}
                  color={colors.success}
                  onPress={() => setRecurrence(r)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.filterRow}>
          {(['active', 'completed', 'all'] as Filter[]).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)}>
              <Text
                style={[
                  styles.filterText,
                  filter === f && styles.filterTextActive,
                ]}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <FlatList
          data={visibleTasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              onToggle={() => toggleTask(item.id)}
              onDelete={() => deleteTask(item.id)}
              onFocus={() => {
                startTimer({ taskId: item.id, label: item.title, source: 'timer' });
                router.push('/focus');
              }}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-done-outline"
              title={filter === 'completed' ? 'Nothing completed yet' : 'No tasks'}
              message={
                filter === 'completed'
                  ? 'Finished tasks will show up here.'
                  : 'Add your first task above to get started.'
              }
            />
          }
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  onFocus,
}: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
  onFocus: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const overdue = !!due && !task.completed && due.getTime() < Date.now();

  return (
    <View style={styles.taskRow}>
      <Pressable onPress={onToggle} hitSlop={8} style={styles.checkbox}>
        <Ionicons
          name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
          size={26}
          color={task.completed ? colors.success : colors.textFaint}
        />
      </Pressable>

      <View style={styles.taskBody}>
        <Text
          style={[styles.taskTitle, task.completed && styles.taskTitleDone]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          <View
            style={[
              styles.priorityDot,
              { backgroundColor: priorityColor[task.priority] },
            ]}
          />
          <Text style={styles.taskMetaText}>{priorityLabel[task.priority]}</Text>

          {due && (
            <View style={styles.metaPill}>
              <Ionicons
                name="alarm-outline"
                size={12}
                color={overdue ? colors.danger : colors.textMuted}
              />
              <Text
                style={[styles.taskMetaText, overdue && { color: colors.danger }]}
              >
                {relativeDayLabel(due)} {formatClock(due)}
              </Text>
            </View>
          )}

          {task.recurrence !== 'none' && (
            <View style={styles.metaPill}>
              <Ionicons name="repeat" size={12} color={colors.success} />
              <Text style={styles.taskMetaText}>
                {RECURRENCE_LABEL[task.recurrence]}
              </Text>
            </View>
          )}
        </View>
      </View>

      {!task.completed && (
        <Pressable onPress={onFocus} hitSlop={8} style={styles.iconButton}>
          <Ionicons name="play-circle-outline" size={24} color={colors.primary} />
        </Pressable>
      )}
      <Pressable onPress={onDelete} hitSlop={8} style={styles.iconButton}>
        <Ionicons name="trash-outline" size={20} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

function labelForHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, backgroundColor: colors.background },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  optionsButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  addButton: {
    backgroundColor: colors.primary,
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  options: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  optionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xs,
  },
  optionScroll: { gap: spacing.sm, paddingVertical: 2 },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  filterText: {
    color: colors.textFaint,
    fontSize: 15,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.text,
    textDecorationLine: 'underline',
    textDecorationColor: colors.primary,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  checkbox: { paddingRight: spacing.xs },
  taskBody: { flex: 1 },
  taskTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  taskTitleDone: {
    color: colors.textFaint,
    textDecorationLine: 'line-through',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 4,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  taskMetaText: { color: colors.textMuted, fontSize: 13 },
  iconButton: { padding: spacing.xs },
}));
