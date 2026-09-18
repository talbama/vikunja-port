import {shallowMount} from '@vue/test-utils'
import {describe, expect, it, vi} from 'vitest'

const ACTIVE_CHILD = {id: 2, title: 'Active child', parentProjectId: 1, isArchived: false, position: 1, hexColor: ''}
const ARCHIVED_CHILD = {id: 3, title: 'Archived child', parentProjectId: 1, isArchived: true, position: 2, hexColor: ''}

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		getChildProjects: (id: number) => id === 1 ? [ACTIVE_CHILD, ARCHIVED_CHILD] : [],
		toggleProjectFavorite: () => {},
	}),
}))

vi.mock('@/stores/base', () => ({
	useBaseStore: () => ({currentProject: null}),
}))

vi.mock('@/stores/tasks', () => ({
	useTaskStore: () => ({draggedTask: null}),
}))

import ProjectsNavigationItem from './ProjectsNavigationItem.vue'
import ProjectsNavigation from './ProjectsNavigation.vue'

const PARENT_PROJECT = {id: 1, title: 'Parent', isArchived: false, position: 0, hexColor: '', maxPermission: 2}

describe('ProjectsNavigationItem (repro)', () => {
	it('lists the active sub-project and hides the archived one', () => {
		const wrapper = shallowMount(ProjectsNavigationItem, {
			props: {
				project: PARENT_PROJECT,
				canCollapse: true,
			},
			global: {
				mocks: {$t: (key: string) => key},
				stubs: {RouterLink: true},
			},
		})

		const childNav = wrapper.findComponent(ProjectsNavigation)
		const childIds = (childNav.props('modelValue') as {id: number}[]).map(p => p.id)

		expect(childIds).toContain(ACTIVE_CHILD.id)
		expect(childIds).not.toContain(ARCHIVED_CHILD.id)
	})
})
