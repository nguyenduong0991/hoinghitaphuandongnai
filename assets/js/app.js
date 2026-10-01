const STORAGE_KEY = "conferenceList";
const DRAFT_KEY = "conferenceDraft";

/* ===========================
   STORAGE
=========================== */

const StorageService = {

    getConferences() {
        return JSON.parse(
            localStorage.getItem(STORAGE_KEY) || "[]"
        );
    },

    saveConferences(data) {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(data)
        );
    },

    getDraft() {
        return JSON.parse(
            localStorage.getItem(DRAFT_KEY) || "{}"
        );
    },

    saveDraft(data) {
        localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify(data)
        );
    },

    clearDraft() {
        localStorage.removeItem(DRAFT_KEY);
    }

};

/* ===========================
   APP
=========================== */

const App = {

    generateCode() {

        const now = new Date();

        return "HN-" +
            now.getFullYear() +
            String(now.getMonth() + 1)
            .padStart(2, "0") +
            String(now.getDate())
            .padStart(2, "0") +
            "-" +
            now.getTime();
    }

};

/* ===========================
   CONFERENCE SERVICE
=========================== */

const ConferenceService = {

    getAll() {

        return StorageService
            .getConferences();

    },

    getById(id) {

        return this
            .getAll()
            .find(x => x.id == id);

    },

    create(data) {

        const conferences =
            this.getAll();

        conferences.push({

            id: Date.now(),

            code:
                App.generateCode(),

            organization:
                data.organization,

            topic:
                data.topic,

            legalArea:
                data.legalArea,

            participants:
                data.participants,

            date:
                data.date,

            status:
                "Chờ phê duyệt",

            createdDate:
                new Date()
                .toISOString()

        });

        StorageService
            .saveConferences(conferences);

    },

    update(id, data) {

        const conferences =
            this.getAll();

        const item =
            conferences.find(
                x => x.id == id
            );

        if (!item)
            return;

        Object.assign(
            item,
            data
        );

        StorageService
            .saveConferences(conferences);

    },

    delete(id) {

        let conferences =
            this.getAll();

        conferences =
            conferences.filter(
                x => x.id != id
            );

        StorageService
            .saveConferences(conferences);

    }

};

/* ===========================
   WORKFLOW
=========================== */

const Workflow = {

    approve(id) {

        ConferenceService.update(
            id,
            {
                status:
                "Đã phê duyệt"
            }
        );

    },

    needMoreInfo(id) {

        ConferenceService.update(
            id,
            {
                status:
                "Cần bổ sung"
            }
        );

    },

    complete(id) {

        ConferenceService.update(
            id,
            {
                status:
                "Hoàn thành"
            }
        );

    }

};

/* ===========================
   KPI
=========================== */

const DashboardService = {

    getKpi() {

        const data =
            ConferenceService
            .getAll();

        return {

            total:
                data.length,

            pending:
                data.filter(
                    x => x.status ===
                    "Chờ phê duyệt"
                ).length,

            approved:
                data.filter(
                    x => x.status ===
                    "Đã phê duyệt"
                ).length,

            completed:
                data.filter(
                    x => x.status ===
                    "Hoàn thành"
                ).length

        };

    }

};

/* ===========================
   DEMO DATA
=========================== */

function seedDemoData() {

    const list = [];

    for (let i = 1; i <= 20; i++) {

        list.push({

            id: i,

            code:
                "HN-2026-" + i,

            organization:
                "UBND Phường Tam Hiệp",

            topic:
                "Tuyên truyền pháp luật " + i,

            legalArea:
                "Đất đai",

            participants:
                200,

            date:
                "2026-10-15",

            status:
                [
                    "Chờ phê duyệt",
                    "Đã phê duyệt",
                    "Hoàn thành"
                ][Math.floor(Math.random()*3)],

            createdDate:
                new Date()
                .toISOString()

        });

    }

    StorageService
        .saveConferences(list);

    console.log(
        "Đã tạo 20 hồ sơ mẫu"
    );

}
