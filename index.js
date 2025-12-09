const axios = require('axios');
const fs = require('fs');

// --- CONFIGURATION SÉCURISÉE ---
// On cherche les infos dans les variables d'environnement (GitHub Secrets)
// Si on est en local sur ton PC, on peut utiliser des valeurs par défaut ou un fichier .env (mais pour l'instant, modifie juste ça)

const JIRA_DOMAIN = process.env.JIRA_DOMAIN || 'https://unis-team-pll053jl.atlassian.net';
const EMAIL = process.env.JIRA_EMAIL;       // Sera lu depuis GitHub
const API_TOKEN = process.env.JIRA_TOKEN;   // Sera lu depuis GitHub
const PROJECT_KEY = 'UNIS'; 

// Vérification de sécurité
if (!EMAIL || !API_TOKEN) {
    console.error("❌ ERREUR : Les identifiants (Email ou Token) sont manquants.");
    process.exit(1);
}

const authBuffer = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');

const headers = {
  'Authorization': `Basic ${authBuffer}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

async function generateReport() {
    console.log("🚀 Démarrage du générateur (Correction Graphique)...");

    try {
        // 1. Recherche automatique du champ "Team"
        console.log("1. Recherche du champ 'Team'...");
        const fieldsResponse = await axios.get(`${JIRA_DOMAIN}/rest/api/3/field`, { headers });
        const teamField = fieldsResponse.data.find(f => f.name === 'Team');
        
        let teamFieldId = null;
        if (teamField) teamFieldId = teamField.id;

        // 2. Récupération des tickets
        console.log("2. Récupération des données Jira...");
        const fieldsToFetch = ["summary", "status", "assignee", "worklog"];
        if (teamFieldId) fieldsToFetch.push(teamFieldId);

        const payload = {
            jql: `project = "${PROJECT_KEY}"`,
            fields: fieldsToFetch,
            maxResults: 100 
        };

        const response = await axios.post(`${JIRA_DOMAIN}/rest/api/3/search/jql`, payload, { headers });
        const issues = response.data.issues;
        console.log(`✅ ${issues.length} tickets récupérés.`);

        // 3. Transformation des données
        let cleanData = [];

        issues.forEach(issue => {
            let teamName = "Non défini";
            if (teamFieldId && issue.fields[teamFieldId]) {
                const rawTeam = issue.fields[teamFieldId];
                teamName = rawTeam.title || rawTeam.value || rawTeam; 
            }
            const currentStatus = issue.fields.status.name;
            const worklogs = (issue.fields.worklog && issue.fields.worklog.worklogs) ? issue.fields.worklog.worklogs : [];
            
            if (worklogs.length > 0) {
                worklogs.forEach(log => {
                    cleanData.push({
                        key: issue.key,
                        summary: issue.fields.summary,
                        status: currentStatus,
                        team: teamName,
                        date: new Date(log.started).toLocaleDateString('fr-FR'),
                        author: log.author.displayName,
                        timeDisplay: log.timeSpent,
                        comment: extractText(log.comment)
                    });
                });
            } else {
                cleanData.push({
                    key: issue.key,
                    summary: issue.fields.summary,
                    status: currentStatus,
                    team: teamName,
                    date: "-",
                    author: issue.fields.assignee ? issue.fields.assignee.displayName : "Non assigné",
                    timeDisplay: "-",
                    comment: ""
                });
            }
        });

        createExcelReadyHTML(cleanData);

    } catch (error) {
        console.error("❌ ERREUR :", error.message);
    }
}

function createExcelReadyHTML(data) {
    const jsonStr = JSON.stringify(data);

    const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <title>Rapport - ${PROJECT_KEY}</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2"></script>
        <link rel="stylesheet" href="https://cdn.datatables.net/1.13.4/css/jquery.dataTables.css">
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.js"></script>
        <script src="https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js"></script>
        
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #f4f5f7; color: #172B4D; padding: 20px; }
            .container { max-width: 1200px; margin: auto; }
            .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            h1 { color: #0052CC; margin: 0; }
            .btn-excel { background-color: #36B37E; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-weight: bold; }
            .filters { display: flex; gap: 30px; flex-wrap: wrap; margin-bottom: 20px; padding-bottom:15px; border-bottom:1px solid #eee; }
            select { padding: 8px; border: 1px solid #dfe1e6; border-radius: 4px; }
            .checkbox-group { display: flex; gap: 10px; flex-wrap: wrap; }
            .checkbox-item { background: #ebecf0; padding: 5px 12px; border-radius: 15px; cursor: pointer; font-size: 0.9em; }
            .checkbox-item.checked { background: #deebff; color: #0052cc; font-weight: bold; }
            .checkbox-item input { display: none; }
            .chart-wrapper { width: 350px; margin: 0 auto; }
            table.dataTable thead th { background-color: #0052CC; color: white; }
            .tag { padding: 2px 6px; border-radius: 3px; font-size: 0.85em; font-weight: bold; }
            .tag-team { background: #EAE6FF; color: #403294; }
            .tag-status { background: #dfe1e6; color: #42526e; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header-row">
                <h1>📊 Suivi : ${PROJECT_KEY}</h1>
                <button class="btn-excel" onclick="exportToExcel()">📥 Télécharger Excel</button>
            </div>
            
            <div class="card">
                <div class="filters">
                    <div>
                        <label><b>Team :</b></label><br>
                        <select id="teamFilter"><option value="ALL">Toutes</option></select>
                    </div>
                    <div>
                        <label><b>Statut :</b></label><br>
                        <div class="checkbox-group" id="statusFilterContainer"></div>
                    </div>
                </div>
                <div class="chart-wrapper"><canvas id="statusChart"></canvas></div>
            </div>

            <div class="card">
                <table id="mainTable" class="display" style="width:100%">
                    <thead>
                        <tr><th>Clé</th><th>Team</th><th>Tâche</th><th>Statut</th><th>Date Log</th><th>Auteur</th><th>Temps</th><th>Commentaire</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>

        <script>
            const rawData = ${jsonStr};
            let myChart = null;
            let dataTable = null;
            let currentFilteredData = [];

            $(document).ready(function() {
                initFilters();
                updateDashboard();

                $('#teamFilter').on('change', updateDashboard);
                $(document).on('click', '.checkbox-item', function() {
                    const checkbox = $(this).find('input');
                    checkbox.prop('checked', !checkbox.prop('checked'));
                    $(this).toggleClass('checked', checkbox.is(':checked'));
                    updateDashboard();
                });
            });

            function initFilters() {
                const teams = [...new Set(rawData.map(d => d.team))].sort();
                teams.forEach(t => $('#teamFilter').append('<option value="'+t+'">'+t+'</option>'));

                const statuses = [...new Set(rawData.map(d => d.status))].sort();
                statuses.forEach(s => {
                    $('#statusFilterContainer').append(
                        '<label class="checkbox-item checked"><input type="checkbox" value="'+s+'" checked> '+s+'</label>'
                    );
                });
            }

            function updateDashboard() {
                const selectedTeam = $('#teamFilter').val();
                const selectedStatuses = $('#statusFilterContainer input:checked').map(function() { return this.value; }).get();

                currentFilteredData = rawData.filter(item => {
                    const matchTeam = (selectedTeam === "ALL") || (item.team === selectedTeam);
                    const matchStatus = selectedStatuses.includes(item.status);
                    return matchTeam && matchStatus;
                });

                // Update Table
                if (dataTable) dataTable.destroy();
                $('#mainTable tbody').html(currentFilteredData.map(item => \`
                    <tr>
                        <td><a href="${JIRA_DOMAIN}/browse/\${item.key}" target="_blank" style="text-decoration:none; color:#0052cc;">\${item.key}</a></td>
                        <td><span class="tag tag-team">\${item.team}</span></td>
                        <td>\${item.summary}</td>
                        <td><span class="tag tag-status">\${item.status}</span></td>
                        <td>\${item.date}</td>
                        <td>\${item.author}</td>
                        <td>\${item.timeDisplay}</td>
                        <td style="font-size:0.9em; font-style:italic; color:#666;">\${item.comment.substring(0,60)}</td>
                    </tr>
                \`).join(''));
                dataTable = $('#mainTable').DataTable({ language: { url: '//cdn.datatables.net/plug-ins/1.13.4/i18n/fr-FR.json' }, pageLength: 10 });

                updateChart(currentFilteredData);
            }

            function updateChart(data) {
                // --- CORRECTION MAJEURE ICI ---
                // On compte les TICKETS UNIQUES, pas les lignes
                
                let stats = {};
                let uniqueTickets = new Set(); // Sert à mémoriser les clés qu'on a déjà comptées
                let totalTickets = 0;

                data.forEach(d => {
                    // Si on n'a pas encore compté ce ticket-là dans ce jeu de données filtré...
                    if (!uniqueTickets.has(d.key)) {
                        uniqueTickets.add(d.key); // On le marque comme "vu"
                        
                        // On incrémente le compteur pour son statut
                        stats[d.status] = (stats[d.status] || 0) + 1;
                        totalTickets++;
                    }
                });
                // ------------------------------

                const ctx = document.getElementById('statusChart').getContext('2d');
                if (myChart) myChart.destroy();

                myChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: Object.keys(stats),
                        datasets: [{
                            data: Object.values(stats),
                            backgroundColor: ['#0052CC', '#36B37E', '#FFAB00', '#FF5630', '#6554C0', '#00B8D9'],
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { position: 'right' },
                            title: { display: true, text: 'Répartition (Nombre de Tickets Uniques)' },
                            tooltip: {
                                callbacks: {
                                    label: function(ctx) {
                                        let val = ctx.raw;
                                        let pct = Math.round((val/totalTickets)*100) + '%';
                                        return ctx.label + ': ' + val + ' (' + pct + ')';
                                    }
                                }
                            },
                            datalabels: {
                                color: '#fff',
                                formatter: (value, ctx) => {
                                    return Math.round((value / totalTickets) * 100) + "%"; 
                                },
                                font: { weight: 'bold' }
                            }
                        }
                    },
                    plugins: [ChartDataLabels]
                });
            }

            function exportToExcel() {
                const dataForExcel = currentFilteredData.map(item => ({
                    "Clé Ticket": item.key, "Team": item.team, "Résumé": item.summary,
                    "Statut Actuel": item.status, "Date Log": item.date, "Auteur": item.author,
                    "Durée": item.timeDisplay, "Commentaire": item.comment
                }));
                const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Export Jira");
                XLSX.writeFile(workbook, "Rapport_${PROJECT_KEY}.xlsx");
            }
        </script>
    </body>
    </html>`;

    fs.writeFileSync('rapport_client.html', html);
    console.log("✅ Fichier généré ! Le camembert compte maintenant les tickets uniques.");
}

function extractText(commentObj) {
    if (!commentObj) return "";
    if (typeof commentObj === 'string') return commentObj;
    try {
        if (commentObj.content) return commentObj.content.map(p => p.content.map(t => t.text).join('')).join(' ');
    } catch(e) { return "Rich Text"; }
    return "";
}

generateReport();