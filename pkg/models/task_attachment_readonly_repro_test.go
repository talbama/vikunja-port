// Vikunja is a to-do list application to facilitate your life.
// Copyright 2018-present Vikunja and contributors. All rights reserved.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package models

import (
	"testing"

	"code.vikunja.io/api/pkg/db"
	"code.vikunja.io/api/pkg/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTaskAttachment_CanRead_SharedReadOnlyRepro reproduces issue #4:
// a user with read-only access to a task (via a team share with permission 0)
// should be able to read/download its attachments, but CanRead currently
// requires write access and incorrectly denies them.
func TestTaskAttachment_CanRead_SharedReadOnlyRepro(t *testing.T) {
	db.LoadAndAssertFixtures(t)
	s := db.NewSession()
	defer s.Close()

	u := &user.User{ID: 1}
	// Task 15 belongs to project 6, on which team 2 (containing user 1) has
	// read-only (permission 0) access.
	ta := &TaskAttachment{TaskID: 15}
	can, _, err := ta.CanRead(s, u)
	require.NoError(t, err)
	assert.True(t, can, "user with read-only access should be able to read the attachment")
}
