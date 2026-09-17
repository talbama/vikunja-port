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

package webtests

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTaskAttachmentDownload_ReadOnlyShare_Repro reproduces issue #4: a user
// with a read-only share on a project gets "forbidden" when trying to
// download an attachment on a task in that project, even though they can
// read the task itself.
//
// testuser1 owns project 1 (task 1 lives there). We share project 1 with
// testuser2 as read-only (permission 0), then testuser2 tries to download an
// attachment that testuser1 just uploaded to task 1. This must succeed
// (200 OK), the same way testuser2 can already read the task.
func TestTaskAttachmentDownload_ReadOnlyShare_Repro(t *testing.T) {
	e, err := setupTestEnv()
	require.NoError(t, err)

	ownerToken := humaTokenFor(t, &testuser1)

	// Owner uploads a real attachment to task 1 (in project 1, owned by testuser1).
	content := []byte("read only should be able to see this")
	id := uploadOneAttachment(t, e, ownerToken, "readonly.txt", content)

	// Owner shares project 1 with testuser2, read-only.
	shareRec := humaRequest(t, e, http.MethodPost, "/api/v2/projects/1/users", `{"username":"user2","permission":0}`, ownerToken, "")
	require.Equal(t, http.StatusCreated, shareRec.Code, "body: %s", shareRec.Body.String())

	// testuser2 (read-only) downloads the attachment.
	readOnlyToken := humaTokenFor(t, &testuser2)
	rec := humaRequest(t, e, http.MethodGet, "/api/v2/tasks/1/attachments/"+strconv.FormatInt(id, 10), "", readOnlyToken, "")
	assert.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	assert.Equal(t, content, rec.Body.Bytes())
}
